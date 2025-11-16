
import { DaySlot } from '../types';

export const roundToNearest5 = (time: string): string => {
  if (!time) return "08:00";
  const parts = time.split(':');
  if (parts.length < 2) return "08:00";
  
  let h = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10);
  
  if (isNaN(h)) h = 8;
  if (isNaN(m)) m = 0;
  
  m = Math.round(m / 5) * 5;
  
  if (m === 60) {
    m = 0;
    h += 1;
  }
  
  if (h >= 24) h = h % 24;
  
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export const timeToMinutes = (time: string): number => {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return (h * 60) + m;
};

export const minutesToTime = (minutes: number): string => {
  let m = minutes;
  // Normalize to 0-1440 range just for display time
  while (m < 0) m += 1440;
  while (m >= 1440) m -= 1440;
  
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
};

export const calculateSlotMinutes = (start: string, end: string): number => {
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  
  if (startMin === endMin) return 0;
  
  let diff = endMin - startMin;
  
  // If end time is smaller than start time, assume it crosses midnight
  // Example: 23:00 (1380) to 01:00 (60). Diff is -1320.
  // -1320 + 1440 = 120 minutes. Correct.
  if (diff < 0) {
    diff += 1440;
  }
  
  return diff;
};

export const calculateDayNetMinutes = (slots: DaySlot[]): number => {
  return slots.reduce((total, slot) => {
    if (slot.type === 'break') return total;
    return total + calculateSlotMinutes(slot.startTime, slot.endTime);
  }, 0);
};

export const calculateDayRemoteMinutes = (slots: DaySlot[]): number => {
  return slots.reduce((total, slot) => {
    if (slot.type === 'work' && slot.isRemote) {
      return total + calculateSlotMinutes(slot.startTime, slot.endTime);
    }
    return total;
  }, 0);
};

export const getRoleBreakdown = (slots: DaySlot[]) => {
  const stats: Record<string, number> = {};
  
  slots.forEach(slot => {
    if (slot.type === 'work' && slot.roleId) {
      const duration = calculateSlotMinutes(slot.startTime, slot.endTime);
      stats[slot.roleId] = (stats[slot.roleId] || 0) + duration;
    }
  });
  
  return stats;
};

export const formatDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} val. ${m} min.`;
  if (h > 0) return `${h} val.`;
  return `${m} min.`;
};

export const sortSlots = (slots: DaySlot[]): DaySlot[] => {
  return [...slots].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
};