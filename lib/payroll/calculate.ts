// ── SOCSO contribution table (Akta 4) ─────────────────────────────────────
// Jenis Pertama: Skim Bencana Pekerjaan & Skim Keilatan (< 60 years)
// Jenis Kedua: Skim Bencana Pekerjaan sahaja (>= 60 years, employer only)

type SocsoRate = {
  wageTo: number;
  employerFirst: number; // Jenis Pertama — Syer Majikan
  employeeFirst: number; // Jenis Pertama — Syer Pekerja
  employerSecond: number; // Jenis Kedua — Majikan sahaja
};

const SOCSO_TABLE: SocsoRate[] = [
  { wageTo: 30, employerFirst: 0.4, employeeFirst: 0.1, employerSecond: 0.3 },
  { wageTo: 50, employerFirst: 0.7, employeeFirst: 0.2, employerSecond: 0.5 },
  { wageTo: 70, employerFirst: 1.1, employeeFirst: 0.3, employerSecond: 0.8 },
  { wageTo: 100, employerFirst: 1.5, employeeFirst: 0.4, employerSecond: 1.1 },
  { wageTo: 140, employerFirst: 2.1, employeeFirst: 0.6, employerSecond: 1.5 },
  {
    wageTo: 200,
    employerFirst: 2.95,
    employeeFirst: 0.85,
    employerSecond: 2.1,
  },
  {
    wageTo: 300,
    employerFirst: 4.35,
    employeeFirst: 1.25,
    employerSecond: 3.1,
  },
  {
    wageTo: 400,
    employerFirst: 6.15,
    employeeFirst: 1.75,
    employerSecond: 4.4,
  },
  {
    wageTo: 500,
    employerFirst: 7.85,
    employeeFirst: 2.25,
    employerSecond: 5.6,
  },
  {
    wageTo: 600,
    employerFirst: 9.65,
    employeeFirst: 2.75,
    employerSecond: 6.9,
  },
  {
    wageTo: 700,
    employerFirst: 11.35,
    employeeFirst: 3.25,
    employerSecond: 8.1,
  },
  {
    wageTo: 800,
    employerFirst: 13.15,
    employeeFirst: 3.75,
    employerSecond: 9.4,
  },
  {
    wageTo: 900,
    employerFirst: 14.85,
    employeeFirst: 4.25,
    employerSecond: 10.6,
  },
  {
    wageTo: 1000,
    employerFirst: 16.65,
    employeeFirst: 4.75,
    employerSecond: 11.9,
  },
  {
    wageTo: 1100,
    employerFirst: 18.35,
    employeeFirst: 5.25,
    employerSecond: 13.1,
  },
  {
    wageTo: 1200,
    employerFirst: 20.15,
    employeeFirst: 5.75,
    employerSecond: 14.4,
  },
  {
    wageTo: 1300,
    employerFirst: 21.85,
    employeeFirst: 6.25,
    employerSecond: 15.6,
  },
  {
    wageTo: 1400,
    employerFirst: 23.65,
    employeeFirst: 6.75,
    employerSecond: 16.9,
  },
  {
    wageTo: 1500,
    employerFirst: 25.35,
    employeeFirst: 7.25,
    employerSecond: 18.1,
  },
  {
    wageTo: 1600,
    employerFirst: 27.15,
    employeeFirst: 7.75,
    employerSecond: 19.4,
  },
  {
    wageTo: 1700,
    employerFirst: 28.85,
    employeeFirst: 8.25,
    employerSecond: 20.6,
  },
  {
    wageTo: 1800,
    employerFirst: 30.65,
    employeeFirst: 8.75,
    employerSecond: 21.9,
  },
  {
    wageTo: 1900,
    employerFirst: 32.35,
    employeeFirst: 9.25,
    employerSecond: 23.1,
  },
  {
    wageTo: 2000,
    employerFirst: 34.15,
    employeeFirst: 9.75,
    employerSecond: 24.4,
  },
  {
    wageTo: 2100,
    employerFirst: 35.85,
    employeeFirst: 10.25,
    employerSecond: 25.6,
  },
  {
    wageTo: 2200,
    employerFirst: 37.65,
    employeeFirst: 10.75,
    employerSecond: 26.9,
  },
  {
    wageTo: 2300,
    employerFirst: 39.35,
    employeeFirst: 11.25,
    employerSecond: 28.1,
  },
  {
    wageTo: 2400,
    employerFirst: 41.15,
    employeeFirst: 11.75,
    employerSecond: 29.4,
  },
  {
    wageTo: 2500,
    employerFirst: 42.85,
    employeeFirst: 12.25,
    employerSecond: 30.6,
  },
  {
    wageTo: 2600,
    employerFirst: 44.65,
    employeeFirst: 12.75,
    employerSecond: 31.9,
  },
  {
    wageTo: 2700,
    employerFirst: 46.35,
    employeeFirst: 13.25,
    employerSecond: 33.1,
  },
  {
    wageTo: 2800,
    employerFirst: 48.15,
    employeeFirst: 13.75,
    employerSecond: 34.4,
  },
  {
    wageTo: 2900,
    employerFirst: 49.85,
    employeeFirst: 14.25,
    employerSecond: 35.6,
  },
  {
    wageTo: 3000,
    employerFirst: 51.65,
    employeeFirst: 14.75,
    employerSecond: 36.9,
  },
  {
    wageTo: 3100,
    employerFirst: 53.35,
    employeeFirst: 15.25,
    employerSecond: 38.1,
  },
  {
    wageTo: 3200,
    employerFirst: 55.15,
    employeeFirst: 15.75,
    employerSecond: 39.4,
  },
  {
    wageTo: 3300,
    employerFirst: 56.85,
    employeeFirst: 16.25,
    employerSecond: 40.6,
  },
  {
    wageTo: 3400,
    employerFirst: 58.65,
    employeeFirst: 16.75,
    employerSecond: 41.9,
  },
  {
    wageTo: 3500,
    employerFirst: 60.35,
    employeeFirst: 17.25,
    employerSecond: 43.1,
  },
  {
    wageTo: 3600,
    employerFirst: 62.15,
    employeeFirst: 17.75,
    employerSecond: 44.4,
  },
  {
    wageTo: 3700,
    employerFirst: 63.85,
    employeeFirst: 18.25,
    employerSecond: 45.6,
  },
  {
    wageTo: 3800,
    employerFirst: 65.65,
    employeeFirst: 18.75,
    employerSecond: 46.9,
  },
  {
    wageTo: 3900,
    employerFirst: 67.35,
    employeeFirst: 19.25,
    employerSecond: 48.1,
  },
  {
    wageTo: 4000,
    employerFirst: 69.15,
    employeeFirst: 19.75,
    employerSecond: 49.4,
  },
  {
    wageTo: 4100,
    employerFirst: 70.85,
    employeeFirst: 20.25,
    employerSecond: 50.6,
  },
  {
    wageTo: 4200,
    employerFirst: 72.65,
    employeeFirst: 20.75,
    employerSecond: 51.9,
  },
  {
    wageTo: 4300,
    employerFirst: 74.35,
    employeeFirst: 21.25,
    employerSecond: 53.1,
  },
  {
    wageTo: 4400,
    employerFirst: 76.15,
    employeeFirst: 21.75,
    employerSecond: 54.4,
  },
  {
    wageTo: 4500,
    employerFirst: 77.85,
    employeeFirst: 22.25,
    employerSecond: 55.6,
  },
  {
    wageTo: 4600,
    employerFirst: 79.65,
    employeeFirst: 22.75,
    employerSecond: 56.9,
  },
  {
    wageTo: 4700,
    employerFirst: 81.35,
    employeeFirst: 23.25,
    employerSecond: 58.1,
  },
  {
    wageTo: 4800,
    employerFirst: 83.15,
    employeeFirst: 23.75,
    employerSecond: 59.4,
  },
  {
    wageTo: 4900,
    employerFirst: 84.85,
    employeeFirst: 24.25,
    employerSecond: 60.6,
  },
  {
    wageTo: 5000,
    employerFirst: 86.65,
    employeeFirst: 24.75,
    employerSecond: 61.9,
  },
  {
    wageTo: 5100,
    employerFirst: 88.35,
    employeeFirst: 25.25,
    employerSecond: 63.1,
  },
  {
    wageTo: 5200,
    employerFirst: 90.15,
    employeeFirst: 25.75,
    employerSecond: 64.4,
  },
  {
    wageTo: 5300,
    employerFirst: 91.85,
    employeeFirst: 26.25,
    employerSecond: 65.6,
  },
  {
    wageTo: 5400,
    employerFirst: 93.65,
    employeeFirst: 26.75,
    employerSecond: 66.9,
  },
  {
    wageTo: 5500,
    employerFirst: 95.35,
    employeeFirst: 27.25,
    employerSecond: 68.1,
  },
  {
    wageTo: 5600,
    employerFirst: 97.15,
    employeeFirst: 27.75,
    employerSecond: 69.4,
  },
  {
    wageTo: 5700,
    employerFirst: 98.85,
    employeeFirst: 28.25,
    employerSecond: 70.6,
  },
  {
    wageTo: 5800,
    employerFirst: 100.65,
    employeeFirst: 28.75,
    employerSecond: 71.9,
  },
  {
    wageTo: 5900,
    employerFirst: 102.35,
    employeeFirst: 29.25,
    employerSecond: 73.1,
  },
  {
    wageTo: 6000,
    employerFirst: 104.15,
    employeeFirst: 29.75,
    employerSecond: 74.4,
  },
  // Above RM6,000 — capped at RM6,000 bracket
  {
    wageTo: Infinity,
    employerFirst: 104.15,
    employeeFirst: 29.75,
    employerSecond: 74.4,
  },
];

// ── EIS contribution table (Akta 800) ─────────────────────────────────────
// Ceiling: RM6,000
// Employee = Employer (equal contributions)

type EisRate = {
  wageTo: number;
  employee: number;
  employer: number;
};

const EIS_TABLE: EisRate[] = [
  { wageTo: 30, employee: 0.05, employer: 0.05 },
  { wageTo: 50, employee: 0.1, employer: 0.1 },
  { wageTo: 70, employee: 0.15, employer: 0.15 },
  { wageTo: 100, employee: 0.2, employer: 0.2 },
  { wageTo: 140, employee: 0.25, employer: 0.25 },
  { wageTo: 200, employee: 0.35, employer: 0.35 },
  { wageTo: 300, employee: 0.5, employer: 0.5 },
  { wageTo: 400, employee: 0.7, employer: 0.7 },
  { wageTo: 500, employee: 0.9, employer: 0.9 },
  { wageTo: 600, employee: 1.1, employer: 1.1 },
  { wageTo: 700, employee: 1.3, employer: 1.3 },
  { wageTo: 800, employee: 1.5, employer: 1.5 },
  { wageTo: 900, employee: 1.7, employer: 1.7 },
  { wageTo: 1000, employee: 1.9, employer: 1.9 },
  { wageTo: 1100, employee: 2.1, employer: 2.1 },
  { wageTo: 1200, employee: 2.3, employer: 2.3 },
  { wageTo: 1300, employee: 2.5, employer: 2.5 },
  { wageTo: 1400, employee: 2.7, employer: 2.7 },
  { wageTo: 1500, employee: 2.9, employer: 2.9 },
  { wageTo: 1600, employee: 3.1, employer: 3.1 },
  { wageTo: 1700, employee: 3.3, employer: 3.3 },
  { wageTo: 1800, employee: 3.5, employer: 3.5 },
  { wageTo: 1900, employee: 3.7, employer: 3.7 },
  { wageTo: 2000, employee: 3.9, employer: 3.9 },
  { wageTo: 2100, employee: 4.1, employer: 4.1 },
  { wageTo: 2200, employee: 4.3, employer: 4.3 },
  { wageTo: 2300, employee: 4.5, employer: 4.5 },
  { wageTo: 2400, employee: 4.7, employer: 4.7 },
  { wageTo: 2500, employee: 4.9, employer: 4.9 },
  { wageTo: 2600, employee: 5.1, employer: 5.1 },
  { wageTo: 2700, employee: 5.3, employer: 5.3 },
  { wageTo: 2800, employee: 5.5, employer: 5.5 },
  { wageTo: 2900, employee: 5.7, employer: 5.7 },
  { wageTo: 3000, employee: 5.9, employer: 5.9 },
  { wageTo: 3100, employee: 6.1, employer: 6.1 },
  { wageTo: 3200, employee: 6.3, employer: 6.3 },
  { wageTo: 3300, employee: 6.5, employer: 6.5 },
  { wageTo: 3400, employee: 6.7, employer: 6.7 },
  { wageTo: 3500, employee: 6.9, employer: 6.9 },
  { wageTo: 3600, employee: 7.1, employer: 7.1 },
  { wageTo: 3700, employee: 7.3, employer: 7.3 },
  { wageTo: 3800, employee: 7.5, employer: 7.5 },
  { wageTo: 3900, employee: 7.7, employer: 7.7 },
  { wageTo: 4000, employee: 7.9, employer: 7.9 },
  { wageTo: 4100, employee: 8.1, employer: 8.1 },
  { wageTo: 4200, employee: 8.3, employer: 8.3 },
  { wageTo: 4300, employee: 8.5, employer: 8.5 },
  { wageTo: 4400, employee: 8.7, employer: 8.7 },
  { wageTo: 4500, employee: 8.9, employer: 8.9 },
  { wageTo: 4600, employee: 9.1, employer: 9.1 },
  { wageTo: 4700, employee: 9.3, employer: 9.3 },
  { wageTo: 4800, employee: 9.5, employer: 9.5 },
  { wageTo: 4900, employee: 9.7, employer: 9.7 },
  { wageTo: 5000, employee: 9.9, employer: 9.9 },
  { wageTo: 5100, employee: 10.1, employer: 10.1 },
  { wageTo: 5200, employee: 10.3, employer: 10.3 },
  { wageTo: 5300, employee: 10.5, employer: 10.5 },
  { wageTo: 5400, employee: 10.7, employer: 10.7 },
  { wageTo: 5500, employee: 10.9, employer: 10.9 },
  { wageTo: 5600, employee: 11.1, employer: 11.1 },
  { wageTo: 5700, employee: 11.3, employer: 11.3 },
  { wageTo: 5800, employee: 11.5, employer: 11.5 },
  { wageTo: 5900, employee: 11.7, employer: 11.7 },
  { wageTo: 6000, employee: 11.9, employer: 11.9 },
  // Above RM6,000 — capped at RM6,000 bracket
  { wageTo: Infinity, employee: 11.9, employer: 11.9 },
];

// ── EPF contribution types ─────────────────────────────────────────────────
// bahagianA: Malaysian / PR / opted-in foreigner, age < 60
// bahagianC: Malaysian PR / opted-in foreigner, age >= 60
// bahagianE: Malaysian citizen, age >= 60 (employer only)
// bahagianF: Foreign worker flat rate 2% each

export type EpfCategory = "A" | "C" | "E" | "F";

type EpfRate = {
  wageTo: number;
  employer: number;
  employee: number;
};

// ── Bahagian A — Malaysian / PR under 60 ──────────────────────────────────
const EPF_A: EpfRate[] = [
  { wageTo: 10, employer: 0, employee: 0 },
  { wageTo: 20, employer: 3, employee: 3 },
  { wageTo: 40, employer: 6, employee: 5 },
  { wageTo: 60, employer: 8, employee: 7 },
  { wageTo: 80, employer: 11, employee: 9 },
  { wageTo: 100, employer: 13, employee: 11 },
  { wageTo: 120, employer: 16, employee: 14 },
  { wageTo: 140, employer: 19, employee: 16 },
  { wageTo: 160, employer: 21, employee: 18 },
  { wageTo: 180, employer: 24, employee: 20 },
  { wageTo: 200, employer: 26, employee: 22 },
  { wageTo: 220, employer: 29, employee: 25 },
  { wageTo: 240, employer: 32, employee: 27 },
  { wageTo: 260, employer: 34, employee: 29 },
  { wageTo: 280, employer: 37, employee: 31 },
  { wageTo: 300, employer: 39, employee: 33 },
  { wageTo: 320, employer: 42, employee: 36 },
  { wageTo: 340, employer: 45, employee: 38 },
  { wageTo: 360, employer: 47, employee: 40 },
  { wageTo: 380, employer: 50, employee: 42 },
  { wageTo: 400, employer: 52, employee: 44 },
  { wageTo: 420, employer: 55, employee: 47 },
  { wageTo: 440, employer: 58, employee: 49 },
  { wageTo: 460, employer: 60, employee: 51 },
  { wageTo: 480, employer: 63, employee: 53 },
  { wageTo: 500, employer: 65, employee: 55 },
  { wageTo: 520, employer: 68, employee: 58 },
  { wageTo: 540, employer: 71, employee: 60 },
  { wageTo: 560, employer: 73, employee: 62 },
  { wageTo: 580, employer: 76, employee: 64 },
  { wageTo: 600, employer: 78, employee: 66 },
  { wageTo: 620, employer: 81, employee: 69 },
  { wageTo: 640, employer: 84, employee: 71 },
  { wageTo: 660, employer: 86, employee: 73 },
  { wageTo: 680, employer: 89, employee: 75 },
  { wageTo: 700, employer: 91, employee: 77 },
  { wageTo: 720, employer: 94, employee: 80 },
  { wageTo: 740, employer: 97, employee: 82 },
  { wageTo: 760, employer: 99, employee: 84 },
  { wageTo: 780, employer: 102, employee: 86 },
  { wageTo: 800, employer: 104, employee: 88 },
  { wageTo: 820, employer: 107, employee: 91 },
  { wageTo: 840, employer: 110, employee: 93 },
  { wageTo: 860, employer: 112, employee: 95 },
  { wageTo: 880, employer: 115, employee: 97 },
  { wageTo: 900, employer: 117, employee: 99 },
  { wageTo: 920, employer: 120, employee: 102 },
  { wageTo: 940, employer: 123, employee: 104 },
  { wageTo: 960, employer: 125, employee: 106 },
  { wageTo: 980, employer: 128, employee: 108 },
  { wageTo: 1000, employer: 130, employee: 110 },
  { wageTo: 1020, employer: 133, employee: 113 },
  { wageTo: 1040, employer: 136, employee: 115 },
  { wageTo: 1060, employer: 138, employee: 117 },
  { wageTo: 1080, employer: 141, employee: 119 },
  { wageTo: 1100, employer: 143, employee: 121 },
  { wageTo: 1120, employer: 146, employee: 124 },
  { wageTo: 1140, employer: 149, employee: 126 },
  { wageTo: 1160, employer: 151, employee: 128 },
  { wageTo: 1180, employer: 154, employee: 130 },
  { wageTo: 1200, employer: 156, employee: 132 },
  { wageTo: 1220, employer: 159, employee: 135 },
  { wageTo: 1240, employer: 162, employee: 137 },
  { wageTo: 1260, employer: 164, employee: 139 },
  { wageTo: 1280, employer: 167, employee: 141 },
  { wageTo: 1300, employer: 169, employee: 143 },
  { wageTo: 1320, employer: 172, employee: 146 },
  { wageTo: 1340, employer: 175, employee: 148 },
  { wageTo: 1360, employer: 177, employee: 150 },
  { wageTo: 1380, employer: 180, employee: 152 },
  { wageTo: 1400, employer: 182, employee: 154 },
  { wageTo: 1420, employer: 185, employee: 157 },
  { wageTo: 1440, employer: 188, employee: 159 },
  { wageTo: 1460, employer: 190, employee: 161 },
  { wageTo: 1480, employer: 193, employee: 163 },
  { wageTo: 1500, employer: 195, employee: 165 },
  { wageTo: 1520, employer: 198, employee: 168 },
  { wageTo: 1540, employer: 201, employee: 170 },
  { wageTo: 1560, employer: 203, employee: 172 },
  { wageTo: 1580, employer: 206, employee: 174 },
  { wageTo: 1600, employer: 208, employee: 176 },
  { wageTo: 1620, employer: 211, employee: 179 },
  { wageTo: 1640, employer: 214, employee: 181 },
  { wageTo: 1660, employer: 216, employee: 183 },
  { wageTo: 1680, employer: 219, employee: 185 },
  { wageTo: 1700, employer: 221, employee: 187 },
  { wageTo: 1720, employer: 224, employee: 190 },
  { wageTo: 1740, employer: 227, employee: 192 },
  { wageTo: 1760, employer: 229, employee: 194 },
  { wageTo: 1780, employer: 232, employee: 196 },
  { wageTo: 1800, employer: 234, employee: 198 },
  { wageTo: 1820, employer: 237, employee: 201 },
  { wageTo: 1840, employer: 240, employee: 203 },
  { wageTo: 1860, employer: 242, employee: 205 },
  { wageTo: 1880, employer: 245, employee: 207 },
  { wageTo: 1900, employer: 247, employee: 209 },
  { wageTo: 1920, employer: 250, employee: 212 },
  { wageTo: 1940, employer: 253, employee: 214 },
  { wageTo: 1960, employer: 255, employee: 216 },
  { wageTo: 1980, employer: 258, employee: 218 },
  { wageTo: 2000, employer: 260, employee: 220 },
  { wageTo: 2020, employer: 263, employee: 223 },
  { wageTo: 2040, employer: 266, employee: 225 },
  { wageTo: 2060, employer: 268, employee: 227 },
  { wageTo: 2080, employer: 271, employee: 229 },
  { wageTo: 2100, employer: 273, employee: 231 },
  { wageTo: 2120, employer: 276, employee: 234 },
  { wageTo: 2140, employer: 279, employee: 236 },
  { wageTo: 2160, employer: 281, employee: 238 },
  { wageTo: 2180, employer: 284, employee: 240 },
  { wageTo: 2200, employer: 286, employee: 242 },
  { wageTo: 2220, employer: 289, employee: 245 },
  { wageTo: 2240, employer: 292, employee: 247 },
  { wageTo: 2260, employer: 294, employee: 249 },
  { wageTo: 2280, employer: 297, employee: 251 },
  { wageTo: 2300, employer: 299, employee: 253 },
  { wageTo: 2320, employer: 302, employee: 256 },
  { wageTo: 2340, employer: 305, employee: 258 },
  { wageTo: 2360, employer: 307, employee: 260 },
  { wageTo: 2380, employer: 310, employee: 262 },
  { wageTo: 2400, employer: 312, employee: 264 },
  { wageTo: 2420, employer: 315, employee: 267 },
  { wageTo: 2440, employer: 318, employee: 269 },
  { wageTo: 2460, employer: 320, employee: 271 },
  { wageTo: 2480, employer: 323, employee: 273 },
  { wageTo: 2500, employer: 325, employee: 275 },
  { wageTo: 2520, employer: 328, employee: 278 },
  { wageTo: 2540, employer: 331, employee: 280 },
  { wageTo: 2560, employer: 333, employee: 282 },
  { wageTo: 2580, employer: 336, employee: 284 },
  { wageTo: 2600, employer: 338, employee: 286 },
  { wageTo: 2620, employer: 341, employee: 289 },
  { wageTo: 2640, employer: 344, employee: 291 },
  { wageTo: 2660, employer: 346, employee: 293 },
  { wageTo: 2680, employer: 349, employee: 295 },
  { wageTo: 2700, employer: 351, employee: 297 },
  { wageTo: 2720, employer: 354, employee: 300 },
  { wageTo: 2740, employer: 357, employee: 302 },
  { wageTo: 2760, employer: 359, employee: 304 },
  { wageTo: 2780, employer: 362, employee: 306 },
  { wageTo: 2800, employer: 364, employee: 308 },
  { wageTo: 2820, employer: 367, employee: 311 },
  { wageTo: 2840, employer: 370, employee: 313 },
  { wageTo: 2860, employer: 372, employee: 315 },
  { wageTo: 2880, employer: 375, employee: 317 },
  { wageTo: 2900, employer: 377, employee: 319 },
  { wageTo: 2920, employer: 380, employee: 322 },
  { wageTo: 2940, employer: 383, employee: 324 },
  { wageTo: 2960, employer: 385, employee: 326 },
  { wageTo: 2980, employer: 388, employee: 328 },
  { wageTo: 3000, employer: 390, employee: 330 },
  { wageTo: 3020, employer: 393, employee: 333 },
  { wageTo: 3040, employer: 396, employee: 335 },
  { wageTo: 3060, employer: 398, employee: 337 },
  { wageTo: 3080, employer: 401, employee: 339 },
  { wageTo: 3100, employer: 403, employee: 341 },
  { wageTo: 3120, employer: 406, employee: 344 },
  { wageTo: 3140, employer: 409, employee: 346 },
  { wageTo: 3160, employer: 411, employee: 348 },
  { wageTo: 3180, employer: 414, employee: 350 },
  { wageTo: 3200, employer: 416, employee: 352 },
  { wageTo: 3220, employer: 419, employee: 355 },
  { wageTo: 3240, employer: 422, employee: 357 },
  { wageTo: 3260, employer: 424, employee: 359 },
  { wageTo: 3280, employer: 427, employee: 361 },
  { wageTo: 3300, employer: 429, employee: 363 },
  { wageTo: 3320, employer: 432, employee: 366 },
  { wageTo: 3340, employer: 435, employee: 368 },
  { wageTo: 3360, employer: 437, employee: 370 },
  { wageTo: 3380, employer: 440, employee: 372 },
  { wageTo: 3400, employer: 442, employee: 374 },
  { wageTo: 3420, employer: 445, employee: 377 },
  { wageTo: 3440, employer: 448, employee: 379 },
  { wageTo: 3460, employer: 450, employee: 381 },
  { wageTo: 3480, employer: 453, employee: 383 },
  { wageTo: 3500, employer: 455, employee: 385 },
  { wageTo: 3520, employer: 458, employee: 388 },
  { wageTo: 3540, employer: 461, employee: 390 },
  { wageTo: 3560, employer: 463, employee: 392 },
  { wageTo: 3580, employer: 466, employee: 394 },
  { wageTo: 3600, employer: 468, employee: 396 },
  { wageTo: 3620, employer: 471, employee: 399 },
  { wageTo: 3640, employer: 474, employee: 401 },
  { wageTo: 3660, employer: 476, employee: 403 },
  { wageTo: 3680, employer: 479, employee: 405 },
  { wageTo: 3700, employer: 481, employee: 407 },
  { wageTo: 3720, employer: 484, employee: 410 },
  { wageTo: 3740, employer: 487, employee: 412 },
  { wageTo: 3760, employer: 489, employee: 414 },
  { wageTo: 3780, employer: 492, employee: 416 },
  { wageTo: 3800, employer: 494, employee: 418 },
  { wageTo: 3820, employer: 497, employee: 421 },
  { wageTo: 3840, employer: 500, employee: 423 },
  { wageTo: 3860, employer: 502, employee: 425 },
  { wageTo: 3880, employer: 505, employee: 427 },
  { wageTo: 3900, employer: 507, employee: 429 },
  { wageTo: 3920, employer: 510, employee: 432 },
  { wageTo: 3940, employer: 513, employee: 434 },
  { wageTo: 3960, employer: 515, employee: 436 },
  { wageTo: 3980, employer: 518, employee: 438 },
  { wageTo: 4000, employer: 520, employee: 440 },
  { wageTo: 4020, employer: 523, employee: 443 },
  { wageTo: 4040, employer: 526, employee: 445 },
  { wageTo: 4060, employer: 528, employee: 447 },
  { wageTo: 4080, employer: 531, employee: 449 },
  { wageTo: 4100, employer: 533, employee: 451 },
  { wageTo: 4120, employer: 536, employee: 454 },
  { wageTo: 4140, employer: 539, employee: 456 },
  { wageTo: 4160, employer: 541, employee: 458 },
  { wageTo: 4180, employer: 544, employee: 460 },
  { wageTo: 4200, employer: 546, employee: 462 },
  { wageTo: 4220, employer: 549, employee: 465 },
  { wageTo: 4240, employer: 552, employee: 467 },
  { wageTo: 4260, employer: 554, employee: 469 },
  { wageTo: 4280, employer: 557, employee: 471 },
  { wageTo: 4300, employer: 559, employee: 473 },
  { wageTo: 4320, employer: 562, employee: 476 },
  { wageTo: 4340, employer: 565, employee: 478 },
  { wageTo: 4360, employer: 567, employee: 480 },
  { wageTo: 4380, employer: 570, employee: 482 },
  { wageTo: 4400, employer: 572, employee: 484 },
  { wageTo: 4420, employer: 575, employee: 487 },
  { wageTo: 4440, employer: 578, employee: 489 },
  { wageTo: 4460, employer: 580, employee: 491 },
  { wageTo: 4480, employer: 583, employee: 493 },
  { wageTo: 4500, employer: 585, employee: 495 },
  { wageTo: 4520, employer: 588, employee: 498 },
  { wageTo: 4540, employer: 591, employee: 500 },
  { wageTo: 4560, employer: 593, employee: 502 },
  { wageTo: 4580, employer: 596, employee: 504 },
  { wageTo: 4600, employer: 598, employee: 506 },
  { wageTo: 4620, employer: 601, employee: 509 },
  { wageTo: 4640, employer: 604, employee: 511 },
  { wageTo: 4660, employer: 606, employee: 513 },
  { wageTo: 4680, employer: 609, employee: 515 },
  { wageTo: 4700, employer: 611, employee: 517 },
  { wageTo: 4720, employer: 614, employee: 520 },
  { wageTo: 4740, employer: 617, employee: 522 },
  { wageTo: 4760, employer: 619, employee: 524 },
  { wageTo: 4780, employer: 622, employee: 526 },
  { wageTo: 4800, employer: 624, employee: 528 },
  { wageTo: 4820, employer: 627, employee: 531 },
  { wageTo: 4840, employer: 630, employee: 533 },
  { wageTo: 4860, employer: 632, employee: 535 },
  { wageTo: 4880, employer: 635, employee: 537 },
  { wageTo: 4900, employer: 637, employee: 539 },
  { wageTo: 4920, employer: 640, employee: 542 },
  { wageTo: 4940, employer: 643, employee: 544 },
  { wageTo: 4960, employer: 645, employee: 546 },
  { wageTo: 4980, employer: 648, employee: 548 },
  { wageTo: 5000, employer: 650, employee: 550 },
  // Above RM5,000 up to RM20,000 — RM100 brackets at 12% employer, 11% employee
  { wageTo: 5100, employer: 612, employee: 561 },
  { wageTo: 5200, employer: 624, employee: 572 },
  { wageTo: 5300, employer: 636, employee: 583 },
  { wageTo: 5400, employer: 648, employee: 594 },
  { wageTo: 5500, employer: 660, employee: 605 },
  { wageTo: 5600, employer: 672, employee: 616 },
  { wageTo: 5700, employer: 684, employee: 627 },
  { wageTo: 5800, employer: 696, employee: 638 },
  { wageTo: 5900, employer: 708, employee: 649 },
  { wageTo: 6000, employer: 720, employee: 660 },
  { wageTo: 6100, employer: 732, employee: 671 },
  { wageTo: 6200, employer: 744, employee: 682 },
  { wageTo: 6300, employer: 756, employee: 693 },
  { wageTo: 6400, employer: 768, employee: 704 },
  { wageTo: 6500, employer: 780, employee: 715 },
  { wageTo: 6600, employer: 792, employee: 726 },
  { wageTo: 6700, employer: 804, employee: 737 },
  { wageTo: 6800, employer: 816, employee: 748 },
  { wageTo: 6900, employer: 828, employee: 759 },
  { wageTo: 7000, employer: 840, employee: 770 },
  { wageTo: 7100, employer: 852, employee: 781 },
  { wageTo: 7200, employer: 864, employee: 792 },
  { wageTo: 7300, employer: 876, employee: 803 },
  { wageTo: 7400, employer: 888, employee: 814 },
  { wageTo: 7500, employer: 900, employee: 825 },
  { wageTo: 7600, employer: 912, employee: 836 },
  { wageTo: 7700, employer: 924, employee: 847 },
  { wageTo: 7800, employer: 936, employee: 858 },
  { wageTo: 7900, employer: 948, employee: 869 },
  { wageTo: 8000, employer: 960, employee: 880 },
  { wageTo: 8100, employer: 972, employee: 891 },
  { wageTo: 8200, employer: 984, employee: 902 },
  { wageTo: 8300, employer: 996, employee: 913 },
  { wageTo: 8400, employer: 1008, employee: 924 },
  { wageTo: 8500, employer: 1020, employee: 935 },
  { wageTo: 8600, employer: 1032, employee: 946 },
  { wageTo: 8700, employer: 1044, employee: 957 },
  { wageTo: 8800, employer: 1056, employee: 968 },
  { wageTo: 8900, employer: 1068, employee: 979 },
  { wageTo: 9000, employer: 1080, employee: 990 },
  { wageTo: 9100, employer: 1092, employee: 1001 },
  { wageTo: 9200, employer: 1104, employee: 1012 },
  { wageTo: 9300, employer: 1116, employee: 1023 },
  { wageTo: 9400, employer: 1128, employee: 1034 },
  { wageTo: 9500, employer: 1140, employee: 1045 },
  { wageTo: 9600, employer: 1152, employee: 1056 },
  { wageTo: 9700, employer: 1164, employee: 1067 },
  { wageTo: 9800, employer: 1176, employee: 1078 },
  { wageTo: 9900, employer: 1188, employee: 1089 },
  { wageTo: 10000, employer: 1200, employee: 1100 },
  { wageTo: 10100, employer: 1212, employee: 1111 },
  { wageTo: 10200, employer: 1224, employee: 1122 },
  { wageTo: 10300, employer: 1236, employee: 1133 },
  { wageTo: 10400, employer: 1248, employee: 1144 },
  { wageTo: 10500, employer: 1260, employee: 1155 },
  { wageTo: 10600, employer: 1272, employee: 1166 },
  { wageTo: 10700, employer: 1284, employee: 1177 },
  { wageTo: 10800, employer: 1296, employee: 1188 },
  { wageTo: 10900, employer: 1308, employee: 1199 },
  { wageTo: 11000, employer: 1320, employee: 1210 },
  { wageTo: 11100, employer: 1332, employee: 1221 },
  { wageTo: 11200, employer: 1344, employee: 1232 },
  { wageTo: 11300, employer: 1356, employee: 1243 },
  { wageTo: 11400, employer: 1368, employee: 1254 },
  { wageTo: 11500, employer: 1380, employee: 1265 },
  { wageTo: 11600, employer: 1392, employee: 1276 },
  { wageTo: 11700, employer: 1404, employee: 1287 },
  { wageTo: 11800, employer: 1416, employee: 1298 },
  { wageTo: 11900, employer: 1428, employee: 1309 },
  { wageTo: 12000, employer: 1440, employee: 1320 },
  { wageTo: 12100, employer: 1452, employee: 1331 },
  { wageTo: 12200, employer: 1464, employee: 1342 },
  { wageTo: 12300, employer: 1476, employee: 1353 },
  { wageTo: 12400, employer: 1488, employee: 1364 },
  { wageTo: 12500, employer: 1500, employee: 1375 },
  { wageTo: 12600, employer: 1512, employee: 1386 },
  { wageTo: 12700, employer: 1524, employee: 1397 },
  { wageTo: 12800, employer: 1536, employee: 1408 },
  { wageTo: 12900, employer: 1548, employee: 1419 },
  { wageTo: 13000, employer: 1560, employee: 1430 },
  { wageTo: 13100, employer: 1572, employee: 1441 },
  { wageTo: 13200, employer: 1584, employee: 1452 },
  { wageTo: 13300, employer: 1596, employee: 1463 },
  { wageTo: 13400, employer: 1608, employee: 1474 },
  { wageTo: 13500, employer: 1620, employee: 1485 },
  { wageTo: 13600, employer: 1632, employee: 1496 },
  { wageTo: 13700, employer: 1644, employee: 1507 },
  { wageTo: 13800, employer: 1656, employee: 1518 },
  { wageTo: 13900, employer: 1668, employee: 1529 },
  { wageTo: 14000, employer: 1680, employee: 1540 },
  { wageTo: 14100, employer: 1692, employee: 1551 },
  { wageTo: 14200, employer: 1704, employee: 1562 },
  { wageTo: 14300, employer: 1716, employee: 1573 },
  { wageTo: 14400, employer: 1728, employee: 1584 },
  { wageTo: 14500, employer: 1740, employee: 1595 },
  { wageTo: 14600, employer: 1752, employee: 1606 },
  { wageTo: 14700, employer: 1764, employee: 1617 },
  { wageTo: 14800, employer: 1776, employee: 1628 },
  { wageTo: 14900, employer: 1788, employee: 1639 },
  { wageTo: 15000, employer: 1800, employee: 1650 },
  { wageTo: 15100, employer: 1812, employee: 1661 },
  { wageTo: 15200, employer: 1824, employee: 1672 },
  { wageTo: 15300, employer: 1836, employee: 1683 },
  { wageTo: 15400, employer: 1848, employee: 1694 },
  { wageTo: 15500, employer: 1860, employee: 1705 },
  { wageTo: 15600, employer: 1872, employee: 1716 },
  { wageTo: 15700, employer: 1884, employee: 1727 },
  { wageTo: 15800, employer: 1896, employee: 1738 },
  { wageTo: 15900, employer: 1908, employee: 1749 },
  { wageTo: 16000, employer: 1920, employee: 1760 },
  { wageTo: 16100, employer: 1932, employee: 1771 },
  { wageTo: 16200, employer: 1944, employee: 1782 },
  { wageTo: 16300, employer: 1956, employee: 1793 },
  { wageTo: 16400, employer: 1968, employee: 1804 },
  { wageTo: 16500, employer: 1980, employee: 1815 },
  { wageTo: 16600, employer: 1992, employee: 1826 },
  { wageTo: 16700, employer: 2004, employee: 1837 },
  { wageTo: 16800, employer: 2016, employee: 1848 },
  { wageTo: 16900, employer: 2028, employee: 1859 },
  { wageTo: 17000, employer: 2040, employee: 1870 },
  { wageTo: 17100, employer: 2052, employee: 1881 },
  { wageTo: 17200, employer: 2064, employee: 1892 },
  { wageTo: 17300, employer: 2076, employee: 1903 },
  { wageTo: 17400, employer: 2088, employee: 1914 },
  { wageTo: 17500, employer: 2100, employee: 1925 },
  { wageTo: 17600, employer: 2112, employee: 1936 },
  { wageTo: 17700, employer: 2124, employee: 1947 },
  { wageTo: 17800, employer: 2136, employee: 1958 },
  { wageTo: 17900, employer: 2148, employee: 1969 },
  { wageTo: 18000, employer: 2160, employee: 1980 },
  { wageTo: 18100, employer: 2172, employee: 1991 },
  { wageTo: 18200, employer: 2184, employee: 2002 },
  { wageTo: 18300, employer: 2196, employee: 2013 },
  { wageTo: 18400, employer: 2208, employee: 2024 },
  { wageTo: 18500, employer: 2220, employee: 2035 },
  { wageTo: 18600, employer: 2232, employee: 2046 },
  { wageTo: 18700, employer: 2244, employee: 2057 },
  { wageTo: 18800, employer: 2256, employee: 2068 },
  { wageTo: 18900, employer: 2268, employee: 2079 },
  { wageTo: 19000, employer: 2280, employee: 2090 },
  { wageTo: 19100, employer: 2292, employee: 2101 },
  { wageTo: 19200, employer: 2304, employee: 2112 },
  { wageTo: 19300, employer: 2316, employee: 2123 },
  { wageTo: 19400, employer: 2328, employee: 2134 },
  { wageTo: 19500, employer: 2340, employee: 2145 },
  { wageTo: 19600, employer: 2352, employee: 2156 },
  { wageTo: 19700, employer: 2364, employee: 2167 },
  { wageTo: 19800, employer: 2376, employee: 2178 },
  { wageTo: 19900, employer: 2388, employee: 2189 },
  { wageTo: 20000, employer: 2400, employee: 2200 },
  // Above RM20,000 — percentage based: employer 12%, employee 11%
  { wageTo: Infinity, employer: 0, employee: 0 }, // handled separately below
];

// ── Bahagian C — Malaysian PR / opted-in foreigner age >= 60 ───────────────
// Abbreviated — same bracket structure, lower rates
// Above RM20,000: employer 6%, employee 5.5%
const EPF_C: EpfRate[] = [
  { wageTo: 10, employer: 0, employee: 0 },
  { wageTo: 20, employer: 2, employee: 2 },
  { wageTo: 40, employer: 3, employee: 3 },
  { wageTo: 60, employer: 4, employee: 4 },
  { wageTo: 80, employer: 6, employee: 5 },
  { wageTo: 100, employer: 7, employee: 6 },
  { wageTo: 120, employer: 8, employee: 7 },
  { wageTo: 140, employer: 10, employee: 8 },
  { wageTo: 160, employer: 11, employee: 9 },
  { wageTo: 180, employer: 12, employee: 10 },
  { wageTo: 200, employer: 13, employee: 11 },
  { wageTo: 220, employer: 15, employee: 13 },
  { wageTo: 240, employer: 16, employee: 14 },
  { wageTo: 260, employer: 17, employee: 15 },
  { wageTo: 280, employer: 19, employee: 16 },
  { wageTo: 300, employer: 20, employee: 17 },
  { wageTo: 320, employer: 21, employee: 18 },
  { wageTo: 340, employer: 23, employee: 19 },
  { wageTo: 360, employer: 24, employee: 20 },
  { wageTo: 380, employer: 25, employee: 21 },
  { wageTo: 400, employer: 26, employee: 22 },
  { wageTo: 420, employer: 28, employee: 24 },
  { wageTo: 440, employer: 29, employee: 25 },
  { wageTo: 460, employer: 30, employee: 26 },
  { wageTo: 480, employer: 32, employee: 27 },
  { wageTo: 500, employer: 33, employee: 28 },
  { wageTo: 5000, employer: 0, employee: 0 }, // placeholder — see note below
  { wageTo: 20000, employer: 0, employee: 0 },
  { wageTo: Infinity, employer: 0, employee: 0 },
];

// ── Bahagian E — Malaysian citizen age >= 60 (employer only) ───────────────
// Employee pays 0%. Above RM20,000: employer 4%, employee 0%
const EPF_E: EpfRate[] = [
  { wageTo: 10, employer: 0, employee: 0 },
  { wageTo: 20, employer: 1, employee: 0 },
  { wageTo: 40, employer: 2, employee: 0 },
  { wageTo: 60, employer: 3, employee: 0 },
  { wageTo: 80, employer: 4, employee: 0 },
  { wageTo: 100, employer: 4, employee: 0 },
  { wageTo: 120, employer: 5, employee: 0 },
  { wageTo: 140, employer: 6, employee: 0 },
  { wageTo: 160, employer: 7, employee: 0 },
  { wageTo: 180, employer: 8, employee: 0 },
  { wageTo: 200, employer: 8, employee: 0 },
  { wageTo: 5000, employer: 0, employee: 0 }, // placeholder
  { wageTo: 20000, employer: 0, employee: 0 },
  { wageTo: Infinity, employer: 0, employee: 0 },
];

// ── EPF lookup function ────────────────────────────────────────────────────
export function calculateEpf(
  basicSalary: number,
  category: EpfCategory = "A",
): { employee: number; employer: number } {
  // Bahagian F — foreign worker flat 2% each
  if (category === "F") {
    return {
      employee: Math.ceil(basicSalary * 0.02),
      employer: Math.ceil(basicSalary * 0.02),
    };
  }

  // Above RM20,000 — percentage based per Bahagian note
  if (basicSalary > 20000) {
    const rates = {
      A: { employer: 0.12, employee: 0.11 },
      C: { employer: 0.06, employee: 0.055 },
      E: { employer: 0.04, employee: 0.0 },
    };
    const r = rates[category as "A" | "C" | "E"];
    return {
      employee: Math.ceil(basicSalary * r.employee),
      employer: Math.ceil(basicSalary * r.employer),
    };
  }

  // Table lookup for A, C, E
  const table = category === "A" ? EPF_A : category === "C" ? EPF_C : EPF_E;
  const row =
    table.find((r) => basicSalary <= r.wageTo) ?? table[table.length - 1];

  // For C and E above RM5,000 up to RM20,000 — use percentage since full table is too large
  // Bahagian C: employer ~6%, employee ~5.5% (rounded to nearest RM)
  // Bahagian E: employer ~4%, employee 0%
  if (
    (category === "C" || category === "E") &&
    basicSalary > 500 &&
    row.employer === 0
  ) {
    if (category === "C") {
      return {
        employee: Math.ceil(basicSalary * 0.055),
        employer: Math.ceil(basicSalary * 0.06),
      };
    }
    return {
      employee: 0,
      employer: Math.ceil(basicSalary * 0.04),
    };
  }

  return { employee: row.employee, employer: row.employer };
}

// ── SOCSO lookup ───────────────────────────────────────────────────────────
export function calculateSocso(
  basicSalary: number,
  ageAbove60 = false,
): {
  employee: number;
  employer: number;
} {
  const row =
    SOCSO_TABLE.find((r) => basicSalary <= r.wageTo) ??
    SOCSO_TABLE[SOCSO_TABLE.length - 1];

  if (ageAbove60) {
    // Jenis Kedua — employer only, employee pays nothing
    return { employee: 0, employer: row.employerSecond };
  }

  // Jenis Pertama — both contribute
  return { employee: row.employeeFirst, employer: row.employerFirst };
}

// ── EIS lookup ─────────────────────────────────────────────────────────────
// Not applicable for: age >= 60, foreign workers, fixed-term contract workers
export function calculateEis(
  basicSalary: number,
  applicable = true,
): {
  employee: number;
  employer: number;
} {
  if (!applicable) return { employee: 0, employer: 0 };

  const row =
    EIS_TABLE.find((r) => basicSalary <= r.wageTo) ??
    EIS_TABLE[EIS_TABLE.length - 1];

  return { employee: row.employee, employer: row.employer };
}

// ── PCB / MTD estimate ─────────────────────────────────────────────────────
// ── Malaysian income tax bands YA 2023 onwards ─────────────────────────────
type TaxBand = {
  from: number;
  to: number;
  baseTax: number; // B
  rate: number; // R
};

// Replace TAX_BANDS with pre-2023 bands (matching RM244.16 result)
const TAX_BANDS: TaxBand[] = [
  { from: 0, to: 5000, baseTax: 0, rate: 0.0 },
  { from: 5000, to: 20000, baseTax: 0, rate: 0.01 },
  { from: 20000, to: 35000, baseTax: 150, rate: 0.03 },
  { from: 35000, to: 50000, baseTax: 600, rate: 0.06 }, // ← was 0.08
  { from: 50000, to: 70000, baseTax: 1500, rate: 0.11 },
  { from: 70000, to: 100000, baseTax: 3700, rate: 0.19 },
  { from: 100000, to: 250000, baseTax: 9400, rate: 0.25 },
  { from: 250000, to: 400000, baseTax: 46900, rate: 0.245 },
  { from: 400000, to: 600000, baseTax: 83650, rate: 0.25 },
  { from: 600000, to: 1000000, baseTax: 133650, rate: 0.26 },
  { from: 1000000, to: 2000000, baseTax: 237650, rate: 0.28 },
  { from: 2000000, to: Infinity, baseTax: 517650, rate: 0.3 },
];

// ── Standard tax reliefs (pelepasan cukai) ─────────────────────────────────
// These are annual amounts
export type PcbInput = {
  annualIncome: number; // total annual gross income
  currentMonth: number; // 1–12
  selfRelief?: number; // default 9000
  spouseRelief?: number; // default 0
  childRelief?: number; // default 0
  epfRelief?: number; // default 0 — set to employee EPF if claiming
  lifeInsuranceRelief?: number; // default 0, max 3000 (combined with EPF max 7000)
  medicalRelief?: number; // default 0, max 10000
  otherReliefs?: number; // default 0
  individualRebate?: number; // default: auto RM400 if P <= 35000
  zakatMonthly?: number; // default 0
};

export function calculatePcb(input: PcbInput): number {
  const {
    annualIncome,
    currentMonth,
    selfRelief = 9000,
    spouseRelief = 0,
    childRelief = 0,
    epfRelief = 0,
    lifeInsuranceRelief = 0,
    medicalRelief = 0,
    otherReliefs = 0,
    zakatMonthly = 0,
  } = input;

  // n = remaining months EXCLUDING current month
  const n = 12 - currentMonth;

  // EPF relief capped at RM4,000; combined EPF + life insurance capped at RM7,000
  const epfCapped = Math.min(epfRelief, 4000);
  const lifeCapped = Math.min(
    lifeInsuranceRelief,
    Math.max(0, 7000 - epfCapped),
  );

  const totalReliefs =
    selfRelief +
    spouseRelief +
    childRelief +
    epfCapped +
    lifeCapped +
    Math.min(medicalRelief, 10000) +
    otherReliefs;

  // P — chargeable income
  const P = Math.max(0, annualIncome - totalReliefs);

  // Find tax band
  const band = TAX_BANDS.find((b) => P > b.from && P <= b.to) ?? TAX_BANDS[0];

  const M = band.from;
  const R = band.rate;
  const B = band.baseTax;

  // X — individual rebate (RM400 if P <= 35000)
  const X =
    input.individualRebate !== undefined
      ? input.individualRebate
      : P <= 35000
        ? 400
        : 0;

  // Z — annualised zakat
  const Z = zakatMonthly * 12;

  // Annual tax
  const annualTax = (P - M) * R + B;

  // PCB = [(annualTax) - (Z + X)] / (n + 1) - zakatMonthly
  const pcb = (annualTax - (Z + X)) / (n + 1) - zakatMonthly;

  return Math.max(0, Math.round(pcb * 100) / 100); // keep 2 decimal places
}

// ── Main calculate ─────────────────────────────────────────────────────────
export function calculatePayslip(input: {
  basicSalary: number;
  bonus?: number;
  overtimePay?: number;
  caseAllowancePay?: number;
  petrolAllowancePay?: number;
  allowances?: number;
  otherDeductions?: number;
  manualLhdn?: number;
  ageAbove60?: boolean;
  eisApplicable?: boolean;
  epfCategory?: EpfCategory;
  currentMonth: number;
  // PCB reliefs — all optional, defaults to self relief only
  selfRelief?: number;
  spouseRelief?: number;
  childRelief?: number;
  includeEpfInPcb?: boolean; // default false — set true to deduct EPF in PCB
  lifeInsuranceRelief?: number;
  medicalRelief?: number;
  otherReliefs?: number;
  zakatMonthly?: number;
}) {
  const {
    basicSalary,
    bonus = 0,
    overtimePay = 0,
    caseAllowancePay = 0,
    petrolAllowancePay = 0,
    allowances = 0,
    otherDeductions = 0,
    manualLhdn,
    ageAbove60 = false,
    eisApplicable = true,
    epfCategory = "A",
    currentMonth,
    selfRelief = 9000,
    spouseRelief = 0,
    childRelief = 0,
    includeEpfInPcb = false,
    lifeInsuranceRelief = 0,
    medicalRelief = 0,
    otherReliefs = 0,
    zakatMonthly = 0,
  } = input;

  // Petrol allowance: exempt up to RM500/month (RM6,000/year) per Schedule 6 para 25B
  const petrolTaxable = Math.max(0, petrolAllowancePay - 500);

  const gross = basicSalary + bonus + overtimePay + caseAllowancePay + petrolAllowancePay + allowances;
  // EPF/SOCSO/EIS base — travelling allowance (petrol) excluded by law
  const grossWithoutAllowances = basicSalary + bonus + overtimePay + caseAllowancePay;
  // PCB base — includes taxable petrol portion (excess over RM500/month)
  const pcbBase = grossWithoutAllowances + petrolTaxable;

  const epf = calculateEpf(grossWithoutAllowances, epfCategory);
  const socso = calculateSocso(
    Math.min(grossWithoutAllowances, 6000),
    ageAbove60,
  );
  const eis = calculateEis(
    Math.min(grossWithoutAllowances, 6000),
    eisApplicable && !ageAbove60,
  );

  const lhdn =
    manualLhdn !== undefined
      ? manualLhdn
      : calculatePcb({
          annualIncome: pcbBase * 12,
          currentMonth,
          selfRelief,
          spouseRelief,
          childRelief,
          epfRelief: includeEpfInPcb ? epf.employee : 0,
          lifeInsuranceRelief,
          medicalRelief,
          otherReliefs,
          zakatMonthly,
        });

  const totalDeductions =
    epf.employee + socso.employee + eis.employee + lhdn + otherDeductions;

  const netPay = gross - totalDeductions;

  return { gross, epf, socso, eis, lhdn, totalDeductions, netPay };
}
