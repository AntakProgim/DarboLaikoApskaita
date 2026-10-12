export type SlotType = 'work' | 'break' | 'external';
export type WorkCategory = 'lesson' | 'flexible' | 'general';

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
}

export interface ExternalWorkplace {
  id: string;
  name: string;
  hoursPerWeek?: number;
}

export interface JobRole {
  id: string;
  title: string;
  hours: number; // Full hours
  minutes: number; // Minutes (0-59)
  isPedagogical?: boolean; // Pedagoginis darbas
  contactHours?: number;   // Pamokų / kontaktinės valandos (val.)
  flexibleHours?: number;  // Lanksčios / nekontaktinės valandos (val.)
}

export interface WorkConfig {
  fullName: string;
  isTeacher: boolean;       // Pedagoginis darbuotojas (mokytojas)
  roles: JobRole[]; 
  defaultStartTime: string; // HH:mm
  hasLunch: boolean;
  lunchStartTime: string;   // HH:mm, e.g. "12:00"
  lunchEndTime: string;     // HH:mm, e.g. "12:30"
  lunchDuration: number;    // minutes (e.g. 30)
  hasOtherWorkplaces: boolean;
  otherWorkplaces: ExternalWorkplace[];
}

export interface ValidationResult {
  isValid: boolean;
  message?: string;
}