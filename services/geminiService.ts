import { GoogleGenAI, Type } from "@google/genai";
import { DaySchedule, JobRole, DaySlot, ExternalWorkplace, WeekdayLessons } from "../types";
import { 
  timeToMinutes, 
  minutesToTime, 
  roundToNearest5, 
  STANDARD_LESSON_BELLS, 
  sortSlots, 
  calculateSlotMinutes,
  calculateDailyTargets,
  getSlotAccountedMinutes,
  getSlotTeacherRole,
  PEDAGOGICAL_DAILY_LIMIT_MINUTES 
} from "../utils/timeHelper";

const getAiClient = () => {
  const apiKey = (import.meta as any).env?.VITE_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
};

export const formatTimeStr = (time: string): string => {
  if (!time) return "08:00";
  const parts = time.trim().split(':');
  if (parts.length !== 2) return time;
  const h = parts[0].padStart(2, '0');
  const m = parts[1].padStart(2, '0');
  return `${h}:${m}`;
};

export const generateSmartSchedule = async (
  roles: JobRole[],
  totalWeeklyMinutes: number,
  startTime: string = "08:00",
  lunchDuration: number = 30,
  lunchStartTime: string = "12:00",
  lunchEndTime: string = "12:30",
  hasLunch: boolean = true,
  isTeacher: boolean = false,
  otherWorkplaces: ExternalWorkplace[] = [],
  weeklyLessons?: WeekdayLessons,
  shortFriday: boolean = true
): Promise<DaySchedule[]> => {
  return generateSimpleSchedule(
    roles,
    totalWeeklyMinutes,
    startTime,
    lunchDuration,
    lunchStartTime,
    lunchEndTime,
    hasLunch,
    isTeacher,
    weeklyLessons,
    shortFriday
  );
};

const generateSimpleSchedule = (
    roles: JobRole[], 
    totalWeeklyMinutes: number, 
    startTime: string = "08:00",
    lunchDuration: number = 30,
    lunchStartTime: string = "12:00",
    lunchEndTime: string = "12:30",
    hasLunch: boolean = true,
    isTeacher: boolean = false,
    weeklyLessons?: WeekdayLessons,
    shortFriday: boolean = true
): DaySchedule[] => {
  const days = ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis"];
  const startMin = timeToMinutes(startTime || "08:00");
  const targetLunchStartMin = timeToMinutes(lunchStartTime || "12:00");
  let targetLunchEndMin = timeToMinutes(lunchEndTime || "12:30");
  if (targetLunchEndMin <= targetLunchStartMin) {
    targetLunchEndMin = targetLunchStartMin + (lunchDuration || 30);
  }

  // Calculate day-specific targets (e.g. 8h 15m Mon-Thu, 7h 00m Fri for 40h; 7h 27m Mon-Thu, 6h 12m Fri for 36h)
  const dailyTargets = calculateDailyTargets(totalWeeklyMinutes, shortFriday);

  // Sort roles descending so the primary role with highest workload is processed first
  const sortedRoles = [...roles].sort((a, b) => {
    const minA = a.hours * 60 + a.minutes;
    const minB = b.hours * 60 + b.minutes;
    return minB - minA;
  });

  const primaryRole = sortedRoles[0];
  const primaryRoleId = primaryRole ? primaryRole.id : '1';

  // Identify teaching role (first prioritize title containing "mokyt" / "pamok")
  const teachingRole = getSlotTeacherRole(roles) || primaryRole;
  const lessonRoleId = teachingRole ? teachingRole.id : primaryRoleId;

  // 1. TEACHER / EDUCATIONAL SPECIALIST MODE
  if (isTeacher) {
    // Respect explicit weeklyLessons even if cleared (all empty arrays)
    // Only fallback to default 1-4 lessons if weeklyLessons was completely undefined
    const isLessonsExplicitlyProvided = weeklyLessons !== undefined;
    const dayLessonMap: Record<number, number[]> = {};

    days.forEach((_, dayIndex) => {
      if (isLessonsExplicitlyProvided && weeklyLessons) {
        dayLessonMap[dayIndex] = [...(weeklyLessons[dayIndex] || [])].sort((a, b) => a - b);
      } else {
        // Default 1-4 lessons Mon-Thu, 1-3 lessons Fri
        dayLessonMap[dayIndex] = dayIndex === 4 ? [1, 2, 3] : [1, 2, 3, 4];
      }
    });

    // Secondary roles allocation by days
    const secRolesPerDay: Record<number, { roleId: string; title: string; minutes: number }[]> = {
      0: [], 1: [], 2: [], 3: [], 4: []
    };

    sortedRoles.slice(1).forEach(secRole => {
      const secTotalMin = (secRole.hours * 60) + secRole.minutes;
      if (secTotalMin <= 0) return;

      const pref = secRole.schedulePreference;
      let targetDays: number[] = [];

      if (pref?.days && pref.days.length > 0) {
        targetDays = pref.days;
      } else if (secTotalMin <= 240) {
        // If small duty and no days chosen, default to Wednesday (day 2)
        targetDays = [2];
      } else {
        targetDays = [0, 1, 2, 3, 4];
      }

      const minPerDay = Math.round(secTotalMin / targetDays.length);
      let allocated = 0;

      targetDays.forEach((d, idx) => {
        if (d >= 0 && d <= 4) {
          const toAdd = idx === targetDays.length - 1 ? (secTotalMin - allocated) : minPerDay;
          allocated += toAdd;
          secRolesPerDay[d].push({
            roleId: secRole.id,
            title: secRole.title,
            minutes: toAdd
          });
        }
      });
    });

    return days.map((day, dayIndex) => {
      const slots: DaySlot[] = [];
      const dayTarget = dailyTargets[dayIndex];
      const lessonNumbers = dayLessonMap[dayIndex] || [];
      const secRolesForDay = secRolesPerDay[dayIndex] || [];

      // CASE A: Day has contact lessons
      if (lessonNumbers.length > 0) {
        const firstLessonNum = lessonNumbers[0];
        const firstBell = STANDARD_LESSON_BELLS.find(b => b.number === firstLessonNum);
        const firstBellStartMin = firstBell ? timeToMinutes(firstBell.startTime) : startMin;

        // If the day starts before the first lesson (e.g. 08:00 vs lesson 1 at 08:30 or lesson 2 at 09:25)
        // ALWAYS create a morning slot starting strictly at startMin (08:00)!
        if (firstBellStartMin > startMin) {
          slots.push({
            id: `slot-${dayIndex}-morn-prep`,
            startTime: minutesToTime(startMin),
            endTime: minutesToTime(firstBellStartMin),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
          });
        }

        // Add contact lesson slots - assigned to lessonRoleId (the teacher role)!
        lessonNumbers.forEach(num => {
          const bell = STANDARD_LESSON_BELLS.find(b => b.number === num);
          if (bell) {
            slots.push({
              id: `slot-${dayIndex}-lesson-${num}`,
              startTime: bell.startTime,
              endTime: bell.endTime,
              type: 'work',
              roleId: lessonRoleId,
              isRemote: false,
              workCategory: 'lesson',
              lessonNumber: num
            });
          }
        });

        const lastLessonNum = lessonNumbers[lessonNumbers.length - 1];
        const lastBell = STANDARD_LESSON_BELLS.find(b => b.number === lastLessonNum);
        const lastLessonEndMin = lastBell ? timeToMinutes(lastBell.endTime) : 12 * 60;

        // Determine lunch and afternoon schedule
        let afternoonStartMin = lastLessonEndMin;

        if (hasLunch && lunchDuration > 0 && dayTarget >= 240) {
          // Place lunch break around targetLunchStartMin, keep exact time if no conflict with lessons
          let lunchStartM = targetLunchStartMin;
          let lunchEndM = targetLunchEndMin;

          if (lastLessonEndMin > lunchStartM) {
            lunchStartM = lastLessonEndMin + 10;
            lunchEndM = lunchStartM + (lunchDuration || 30);
          } else {
            lunchStartM = targetLunchStartMin;
            lunchEndM = targetLunchEndMin;
          }

          slots.push({
            id: `slot-${dayIndex}-br`,
            startTime: minutesToTime(lunchStartM),
            endTime: minutesToTime(lunchEndM),
            type: 'break',
            roleId: '',
            isRemote: false
          });

          afternoonStartMin = lunchEndM;
        }

        // Place secondary roles on this day
        let currentClock = afternoonStartMin;
        secRolesForDay.forEach((sec, sIdx) => {
          let secMinToSchedule = sec.minutes;
          if (sec.roleId === lessonRoleId && lessonNumbers.length > 0) {
            const accountedLessonMin = lessonNumbers.length * 60;
            secMinToSchedule = Math.max(0, sec.minutes - accountedLessonMin);
          }

          if (secMinToSchedule > 0) {
            let slotStart = currentClock;
            let slotEnd = currentClock + secMinToSchedule;

            const targetRole = roles.find(r => r.id === sec.roleId);
            const pref = targetRole?.schedulePreference;
            if (pref?.mode === 'custom_times' && pref.startTime) {
              slotStart = timeToMinutes(pref.startTime);
              slotEnd = slotStart + secMinToSchedule;
            }

            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(slotStart),
              endTime: minutesToTime(slotEnd),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: sec.roleId === lessonRoleId ? 'flexible' : 'general'
            });

            if (slotEnd > currentClock) {
              currentClock = slotEnd;
            }
          }
        });

        // Place remaining flexible / work hours for the day so that dayTarget is reached
        const workedSoFar = slots.reduce((total, s) => {
          if (s.type === 'work') return total + getSlotAccountedMinutes(s);
          return total;
        }, 0);

        const afternoonPrimaryNeeded = Math.max(0, dayTarget - workedSoFar);
        if (afternoonPrimaryNeeded > 0) {
          slots.push({
            id: `slot-${dayIndex}-flex-aft`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + afternoonPrimaryNeeded),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
          });
        }

        return {
          id: `day-${dayIndex}`,
          dayName: day,
          dateOffset: dayIndex,
          slots: sortSlots(slots)
        };
      }

      // CASE B: Day has ZERO contact lessons
      if (hasLunch && lunchDuration > 0 && dayTarget >= 240) {
        // Check if any secondary role prefers to work in the morning (starts before lunch)
        const morningSec = secRolesForDay.find(sec => {
          const r = roles.find(role => role.id === sec.roleId);
          const pref = r?.schedulePreference;
          return pref?.mode === 'custom_times' && pref.startTime && timeToMinutes(pref.startTime) < targetLunchStartMin;
        });

        if (morningSec && morningSec.minutes > 0) {
          const r = roles.find(role => role.id === morningSec.roleId);
          const pref = r?.schedulePreference;
          const secStart = timeToMinutes(pref?.startTime || '08:00');
          const secDur = morningSec.minutes;
          const secEnd = secStart + secDur;

          // If there is morning work before secondary role starts
          if (secStart > startMin) {
            slots.push({
              id: `slot-${dayIndex}-pre-sec`,
              startTime: minutesToTime(startMin),
              endTime: minutesToTime(secStart),
              type: 'work',
              roleId: primaryRoleId,
              isRemote: false,
              workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
            });
          }

          // Secondary role slot (duration strictly matches entered minutes)
          slots.push({
            id: `slot-${dayIndex}-sec-morn`,
            startTime: minutesToTime(secStart),
            endTime: minutesToTime(secEnd),
            type: 'work',
            roleId: morningSec.roleId,
            isRemote: false,
            workCategory: morningSec.roleId === lessonRoleId ? 'flexible' : 'general'
          });

          // Work between secondary role end and lunch
          if (secEnd < targetLunchStartMin) {
            slots.push({
              id: `slot-${dayIndex}-post-sec-morn`,
              startTime: minutesToTime(secEnd),
              endTime: minutesToTime(targetLunchStartMin),
              type: 'work',
              roleId: primaryRoleId,
              isRemote: false,
              workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
            });
          }

          // Lunch break
          slots.push({
            id: `slot-${dayIndex}-br`,
            startTime: minutesToTime(targetLunchStartMin),
            endTime: minutesToTime(targetLunchEndMin),
            type: 'break',
            roleId: '',
            isRemote: false
          });

          // Afternoon work to meet full dayTarget
          const workedSoFar = slots.reduce((total, s) => {
            if (s.type === 'work') return total + getSlotAccountedMinutes(s);
            return total;
          }, 0);

          const afternoonPrimaryNeeded = Math.max(0, dayTarget - workedSoFar);
          if (afternoonPrimaryNeeded > 0) {
            slots.push({
              id: `slot-${dayIndex}-aft`,
              startTime: minutesToTime(targetLunchEndMin),
              endTime: minutesToTime(targetLunchEndMin + afternoonPrimaryNeeded),
              type: 'work',
              roleId: primaryRoleId,
              isRemote: false,
              workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
            });
          }
        } else {
          // Standard day: Morning work for primary role
          const morningDur = Math.min(targetLunchStartMin - startMin, dayTarget);
          if (morningDur > 0) {
            slots.push({
              id: `slot-${dayIndex}-morn`,
              startTime: minutesToTime(startMin),
              endTime: minutesToTime(startMin + morningDur),
              type: 'work',
              roleId: primaryRoleId,
              isRemote: false,
              workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
            });
          }

          // Lunch break strictly at target lunch times
          slots.push({
            id: `slot-${dayIndex}-br`,
            startTime: minutesToTime(targetLunchStartMin),
            endTime: minutesToTime(targetLunchEndMin),
            type: 'break',
            roleId: '',
            isRemote: false
          });

          // Afternoon work
          let currentClock = targetLunchEndMin;

          // Schedule secondary roles with exact entered minutes
          secRolesForDay.forEach((sec, sIdx) => {
            if (sec.minutes > 0) {
              let slotStart = currentClock;
              let slotEnd = currentClock + sec.minutes;

              const targetRole = roles.find(r => r.id === sec.roleId);
              const pref = targetRole?.schedulePreference;
              if (pref?.mode === 'custom_times' && pref.startTime) {
                slotStart = timeToMinutes(pref.startTime);
                slotEnd = slotStart + sec.minutes;
              }

              slots.push({
                id: `slot-${dayIndex}-sec-${sIdx}`,
                startTime: minutesToTime(slotStart),
                endTime: minutesToTime(slotEnd),
                type: 'work',
                roleId: sec.roleId,
                isRemote: false,
                workCategory: sec.roleId === lessonRoleId ? 'flexible' : 'general'
              });

              if (slotEnd > currentClock) {
                currentClock = slotEnd;
              }
            }
          });

          // Schedule remaining primary role hours
          const workedSoFar = slots.reduce((total, s) => {
            if (s.type === 'work') return total + getSlotAccountedMinutes(s);
            return total;
          }, 0);

          const afternoonPrimaryNeeded = Math.max(0, dayTarget - workedSoFar);
          if (afternoonPrimaryNeeded > 0) {
            slots.push({
              id: `slot-${dayIndex}-aft`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + afternoonPrimaryNeeded),
              type: 'work',
              roleId: primaryRoleId,
              isRemote: false,
              workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
            });
          }
        }
      } else {
        // No lunch break: continuous work starting strictly at startTime (08:00)
        let currentClock = startMin;

        secRolesForDay.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            let slotStart = currentClock;
            let slotEnd = currentClock + sec.minutes;

            const targetRole = roles.find(r => r.id === sec.roleId);
            const pref = targetRole?.schedulePreference;
            if (pref?.mode === 'custom_times' && pref.startTime) {
              slotStart = timeToMinutes(pref.startTime);
              slotEnd = slotStart + sec.minutes;
            }

            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(slotStart),
              endTime: minutesToTime(slotEnd),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: sec.roleId === lessonRoleId ? 'flexible' : 'general'
            });

            if (slotEnd > currentClock) {
              currentClock = slotEnd;
            }
          }
        });

        const workedSoFar = slots.reduce((total, s) => {
          if (s.type === 'work') return total + getSlotAccountedMinutes(s);
          return total;
        }, 0);

        const remaining = Math.max(0, dayTarget - workedSoFar);
        if (remaining > 0) {
          slots.push({
            id: `slot-${dayIndex}-work`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + remaining),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
          });
        }
      }

      return {
        id: `day-${dayIndex}`,
        dayName: day,
        dateOffset: dayIndex,
        slots: sortSlots(slots)
      };
    });
  }

  // 2. STANDARD NON-TEACHER SCHEDULE (strictly starts at startTime = 08:00, respects day targets)
  let roleQueue = sortedRoles.map(r => ({
    id: r.id,
    remaining: (r.hours * 60) + r.minutes
  }));

  return days.map((day, dayIndex) => {
    const slots: DaySlot[] = [];
    const dayTarget = dailyTargets[dayIndex];
    let currentClock = startMin;
    let dayWorkMinutes = 0;
    let hasBreak = false;
    const shouldHaveLunch = hasLunch && lunchDuration > 0 && dayTarget >= 240;

    while (dayWorkMinutes < dayTarget) {
      if (shouldHaveLunch && !hasBreak && currentClock >= targetLunchStartMin) {
        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: minutesToTime(currentClock),
          endTime: minutesToTime(targetLunchEndMin),
          type: 'break',
          roleId: '',
          isRemote: false
        });
        currentClock = targetLunchEndMin;
        hasBreak = true;
      }

      const activeRoleIndex = roleQueue.findIndex(r => r.remaining > 0);
      if (activeRoleIndex === -1) {
        // If roles exhausted, fill remainder with primary role
        const remainingForDay = dayTarget - dayWorkMinutes;
        if (remainingForDay > 0) {
          slots.push({
            id: `slot-${dayIndex}-${slots.length}`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + remainingForDay),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: 'general'
          });
          currentClock += remainingForDay;
          dayWorkMinutes += remainingForDay;
        }
        break;
      }

      const activeRole = roleQueue[activeRoleIndex];
      const remainingForDay = dayTarget - dayWorkMinutes;
      let maxChunkSize = remainingForDay;

      if (shouldHaveLunch && !hasBreak && currentClock < targetLunchStartMin) {
        const minutesUntilLunch = targetLunchStartMin - currentClock;
        if (minutesUntilLunch > 0 && maxChunkSize > minutesUntilLunch) {
          maxChunkSize = minutesUntilLunch;
        }
      }

      const duration = Math.min(maxChunkSize, activeRole.remaining);

      if (duration > 0) {
        slots.push({
          id: `slot-${dayIndex}-${slots.length}`,
          startTime: minutesToTime(currentClock),
          endTime: minutesToTime(currentClock + duration),
          type: 'work',
          roleId: activeRole.id,
          isRemote: false,
          workCategory: 'general'
        });

        currentClock += duration;
        dayWorkMinutes += duration;
        activeRole.remaining -= duration;
      } else {
        break;
      }
    }

    // Ensure lunch break was added if required and work passed lunch start
    if (shouldHaveLunch && !hasBreak && slots.length > 0) {
      slots.push({
        id: `slot-${dayIndex}-br`,
        startTime: minutesToTime(targetLunchStartMin),
        endTime: minutesToTime(targetLunchEndMin),
        type: 'break',
        roleId: '',
        isRemote: false
      });
    }

    return {
      id: `day-${dayIndex}`,
      dayName: day,
      dateOffset: dayIndex,
      slots: sortSlots(slots)
    };
  });
};

