export type SlotType = 'work' | 'break' | 'external';
export type WorkCategory = 'lesson' | 'flexible' | 'general';
export type RoleCategory = 'teacher' | 'specialist' | 'other';

export interface DaySlot {
  id: string;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  type: SlotType;    // 'work' | 'break' | 'external'
  roleId: string;    // ID of the role from WorkConfig
  isRemote: boolean;
  workCategory?: WorkCategory; // 'lesson' (pamoka), 'flexible' (lanksčios val.), 'general'
  isExternal?: boolean;        // Darbas kitoje darbovietėje
  workplaceName?: string;      // Kitos darbovietės pavadinimas
  lessonNumber?: number;       // 1, 2, 3... pamoka
}

export interface DaySchedule {
  id: string;
  dayName: string; // Pirmadienis, Antradienis, etc.
  dateOffset: number; // 0 for Monday, 1 for Tuesday...
  slots: DaySlot[];
  isRemote?: boolean; // Nuotolinis darbas ('darbas iš namų')
}

export interface ExternalWorkplace {
  id: string;
  name: string;
  hoursPerWeek?: number;
}

export interface RoleSchedulePreference {
  mode: 'custom_times' | 'auto_after_lessons' | 'manual_in_schedule';
  days?: number[]; // [0, 1, 2, 3, 4] (Pirmadienis..Penktadienis)
  startTime?: string; // "14:00"
  endTime?: string;   // "16:00"
  flexibleDays?: number[]; // Pasirinktos dienos lanksčioms valandoms
  flexibleDistribution?: 'after_lessons' | 'equal_days' | 'specific_day';
}

export interface JobRole {
  id: string;
  title: string;
  hours: number; // Full hours
  minutes: number; // Minutes (0-59)
  isPedagogical?: boolean; // Pedagoginis darbas
  roleCategory?: RoleCategory; // 'teacher' | 'specialist' | 'other'
  contactHours?: number;   // Pamokų / kontaktinės valandos (val.)
  flexibleHours?: number;  // Lanksčios / nekontaktinės valandos (val.)
  schedulePreference?: RoleSchedulePreference;
}

export type WeekdayLessons = Record<number, number[]>; // dayOffset (0..4) -> lesson numbers [1, 2, 3...]

export interface WorkConfig {
  fullName: string;
  isTeacher: boolean;       // Pedagoginis darbuotojas (mokytojas ar pagalbos specialistas)
  roles: JobRole[]; 
  defaultStartTime: string; // HH:mm
  hasLunch: boolean;
  lunchStartTime: string;   // HH:mm, e.g. "12:00"
  lunchEndTime: string;     // HH:mm, e.g. "12:30"
  lunchDuration: number;    // minutes (e.g. 30)
  hasOtherWorkplaces: boolean;
  otherWorkplaces: ExternalWorkplace[];
  weeklyLessons?: WeekdayLessons; // Pamokų tvarkaraštis savaitės dienomis
  hasCustomLessons?: boolean;
  shortFriday?: boolean; // Penktadieniais 1 val. trumpiau (I-IV +15 min, V -60 min)
}

export interface ValidationResult {
  isValid: boolean;
  message?: string;
}