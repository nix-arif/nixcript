// Static audit: cross-checks UI permission gates (can()/hasAccess()) against the
// requireAccess()/requirePermission() check actually enforced by the server action
// the gated control triggers. Flags cases where they don't agree — exactly the class
// of bug found manually in "exclude from PR" (UI: purchase-order:create, server:
// sales-order:update) and the PR-approve button (UI: purchase-order:approve, server:
// purchase-requisition:approve).
//
// Run: npx tsx scripts/audit-permissions.ts

import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

function walk(dir: string, filter: (f: string) => boolean, results: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, results);
    else if (filter(full)) results.push(full);
  }
  return results;
}

function parse(file: string): ts.SourceFile {
  const text = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function isExported(n: ts.Node): boolean {
  const mods = (n as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

// ── Server side: index every exported action's required permission(s) ─────

type ActionInfo = { file: string; line: number; permissions: Set<string> };
const serverActions = new Map<string, ActionInfo>(); // key: `${relFile}::${name}`

function collectPermissionCalls(node: ts.Node, out: Set<string>) {
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const callee = n.expression.text;
      if (callee === "requireAccess" || callee === "requirePermission") {
        const arg = n.arguments[0];
        if (arg && ts.isStringLiteral(arg)) out.add(arg.text);
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
}

function indexServerFile(file: string) {
  const sf = parse(file);
  const rel = path.relative(ROOT, file);

  function register(name: string, line: number, body: ts.Node) {
    const perms = new Set<string>();
    collectPermissionCalls(body, perms);
    serverActions.set(`${rel}::${name}`, { file: rel, line, permissions: perms });
  }

  function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name && n.body && isExported(n)) {
      register(n.name.text, sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, n.body);
    } else if (ts.isVariableStatement(n) && isExported(n)) {
      for (const decl of n.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
          decl.initializer.body
        ) {
          register(decl.name.text, sf.getLineAndCharacterOfPosition(decl.getStart()).line + 1, decl.initializer.body);
        }
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
}

// ── Client side helpers ─────────────────────────────────────────────────────

function collectPermRefs(node: ts.Node, permVarMap: Map<string, Set<string>>, out: Set<string>) {
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === "can") {
        const arg = n.arguments[0];
        if (arg && ts.isStringLiteral(arg)) out.add(arg.text);
      } else if (n.expression.text === "hasAccess") {
        const arg = n.arguments[n.arguments.length - 1];
        if (arg && ts.isStringLiteral(arg)) out.add(arg.text);
      }
    } else if (ts.isIdentifier(n) && permVarMap.has(n.text)) {
      const isDeclName = n.parent && ts.isVariableDeclaration(n.parent) && n.parent.name === n;
      if (!isDeclName) for (const p of permVarMap.get(n.text)!) out.add(p);
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
}

function buildPermVarMap(sf: ts.SourceFile): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const empty = new Map<string, Set<string>>();
  function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const set = new Set<string>();
      collectPermRefs(n.initializer, empty, set);
      if (set.size > 0) map.set(n.name.text, set);
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return map;
}

function buildLocalFuncs(sf: ts.SourceFile): Map<string, ts.Node> {
  const map = new Map<string, ts.Node>();
  function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) {
      map.set(n.name.text, n.body);
    } else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) &&
      n.initializer.body
    ) {
      map.set(n.name.text, n.initializer.body);
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return map;
}

function buildImports(sf: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      if (!spec.startsWith("@/server/")) continue;
      const clause = stmt.importClause;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) map.set(el.name.text, spec);
      }
    }
  }
  return map;
}

function getHandlerExpr(attr: ts.JsxAttribute): ts.Expression | null {
  const init = attr.initializer;
  if (!init || !ts.isJsxExpression(init) || !init.expression) return null;
  return init.expression;
}

function collectGateForOnClick(attr: ts.JsxAttribute, permVarMap: Map<string, Set<string>>): Set<string> {
  const gate = new Set<string>();
  let node: ts.Node = attr;
  let steps = 0;
  while (node.parent && steps < 100) {
    const parent: ts.Node = node.parent;
    collectPermRefs(parent, permVarMap, gate);
    const isFn = ts.isArrowFunction(parent) || ts.isFunctionExpression(parent) || ts.isFunctionDeclaration(parent);
    const isJsxMapCallback = isFn && parent.parent && ts.isCallExpression(parent.parent);
    if (isFn && !isJsxMapCallback) break; // reached the component's own function boundary
    node = parent;
    steps++;
  }
  return gate;
}

function resolveServerCallsFromNode(
  node: ts.Node,
  imports: Map<string, string>,
  localFuncs: Map<string, ts.Node>,
  visited: Set<string>,
  depth: number,
  out: { module: string; name: string }[],
) {
  if (depth > 4) return;
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      if (imports.has(name)) {
        out.push({ module: imports.get(name)!, name });
      } else if (localFuncs.has(name) && !visited.has(name)) {
        visited.add(name);
        resolveServerCallsFromNode(localFuncs.get(name)!, imports, localFuncs, visited, depth + 1, out);
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
}

function resolveModuleToRelPath(spec: string): string | null {
  if (!spec.startsWith("@/server/")) return null;
  return spec.slice(2) + ".ts";
}

// ── Main ─────────────────────────────────────────────────────────────────

type Mismatch = { file: string; line: number; gate: string[]; action: string; serverFile: string; server: string[] };
type Ungated = { file: string; line: number; action: string; serverFile: string; server: string[] };

function main() {
  const verbose = process.argv.includes("--verbose");
  const serverFiles = walk(path.join(ROOT, "server"), (f) => f.endsWith(".ts"));
  for (const f of serverFiles) indexServerFile(f);

  const clientFiles = walk(path.join(ROOT, "app"), (f) => f.endsWith(".tsx"));
  const mismatches: Mismatch[] = [];
  const ungated: Ungated[] = [];
  let okCount = 0;

  for (const f of clientFiles) {
    const sf = parse(f);
    const imports = buildImports(sf);
    if (imports.size === 0) continue;
    const permVarMap = buildPermVarMap(sf);
    const localFuncs = buildLocalFuncs(sf);
    const relFile = path.relative(ROOT, f);

    function visit(n: ts.Node) {
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && ["onClick", "onSubmit", "onCheckedChange"].includes(n.name.text)) {
        const handlerExpr = getHandlerExpr(n);
        if (handlerExpr) {
          const calls: { module: string; name: string }[] = [];
          if (ts.isIdentifier(handlerExpr)) {
            const name = handlerExpr.text;
            if (imports.has(name)) calls.push({ module: imports.get(name)!, name });
            else if (localFuncs.has(name)) resolveServerCallsFromNode(localFuncs.get(name)!, imports, localFuncs, new Set([name]), 0, calls);
          } else {
            resolveServerCallsFromNode(handlerExpr, imports, localFuncs, new Set(), 0, calls);
          }

          if (calls.length > 0) {
            const gateSet = collectGateForOnClick(n, permVarMap);
            const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            for (const call of calls) {
              const relPath = resolveModuleToRelPath(call.module);
              if (!relPath) continue;
              const info = serverActions.get(`${relPath}::${call.name}`);
              if (!info || info.permissions.size === 0) continue;

              const overlap = [...gateSet].some((p) => info.permissions.has(p));
              if (gateSet.size === 0) {
                ungated.push({ file: relFile, line, action: call.name, serverFile: relPath, server: [...info.permissions] });
              } else if (!overlap) {
                mismatches.push({
                  file: relFile,
                  line,
                  gate: [...gateSet],
                  action: call.name,
                  serverFile: relPath,
                  server: [...info.permissions],
                });
              } else {
                okCount++;
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(sf);
  }

  console.log(`Indexed ${serverActions.size} exported server actions across ${serverFiles.length} files.`);
  console.log(`Scanned ${clientFiles.length} client files. ${okCount} gate(s) matched their server requirement.\n`);

  if (mismatches.length) {
    console.log(`=== MISMATCHES (${mismatches.length}) — UI gate doesn't match what the server enforces ===\n`);
    for (const m of mismatches) {
      console.log(`${m.file}:${m.line}`);
      console.log(`  UI gate:  ${m.gate.join(" | ")}`);
      console.log(`  calls:    ${m.action}  (${m.serverFile})`);
      console.log(`  requires: ${m.server.join(" | ")}`);
      console.log("");
    }
  } else {
    console.log("No permission mismatches found.\n");
  }

  // Most "ungated" hits are single-purpose create/save pages where the whole page is
  // already gated server-side (requirePermission) and a second client-side check on the
  // one button would be redundant — not a real finding. Keep this noisy list opt-in.
  if (ungated.length) {
    if (verbose) {
      console.log(`=== UNGATED (${ungated.length}) — control has no permission check but the server action requires one ===\n`);
      for (const u of ungated) {
        console.log(`${u.file}:${u.line}  calls ${u.action} (${u.serverFile})  requires ${u.server.join(" | ")}`);
      }
    } else {
      console.log(`${ungated.length} control(s) call a permission-checked action with no client-side gate (often fine — re-run with --verbose to inspect).`);
    }
  }

  if (mismatches.length > 0) process.exitCode = 1;
}

main();
