import React from "react";
import {
  Table,
  TableCaption,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const MembersTable = () => {
  return (
    <div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min">
      <div className="p-4">
        <Table className="">
          <TableCaption>Member Lists</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Staff ID</TableHead>
              <TableHead>Roles</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      </div>
    </div>
  );
};

export default MembersTable;
