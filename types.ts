
export type SlotType = 'work' | 'break';

export interface DaySlot {
  id: string;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  type: SlotType;
  roleId: string;    // ID of the role from WorkConfig
  isRemote: boolean;
}

export interface DaySchedule {
  id: string;
  dayName: string; // Pirmadienis, Antradienis, etc.
  dateOffset: number; // 0 for Monday, 1 for Tuesday...
  slots: DaySlot[];
}

export interface JobRole {
  id: string;
  title: string;
  hours: number; // Full hours
  minutes: number; // Minutes (0-59)
}

export interface WorkConfig {
  fullName: string;
  roles: JobRole[]; 
  defaultStartTime: string; // HH:mm
  lunchDuration: number; // 0, 30, 60 minutes
}

export interface ValidationResult {
  isValid: boolean;
  message?: string;
}