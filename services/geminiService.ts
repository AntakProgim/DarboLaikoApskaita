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
  reconcileScheduleWithRoleTargets,
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

    // Count total contact lessons across the week for the teaching role
    let totalWeeklyTeacherLessons = 0;
    days.forEach((_, dayIndex) => {
      totalWeeklyTeacherLessons += (dayLessonMap[dayIndex] || []).length;
    });
    const totalWeeklyLessonAccountedMin = totalWeeklyTeacherLessons * 60;

    // Calculate total flexible non-contact hours across the week for the teaching role:
    const teacherTargetMin = (teachingRole.hours * 60) + teachingRole.minutes;
    const totalWeeklyTeacherFlexMin = Math.max(0, teacherTargetMin - totalWeeklyLessonAccountedMin);

    // Determine which days should have teacher flexible hours:
    // First priority: Days that have contact lessons
    // Second priority: Preferred days from schedulePreference
    // Fallback: Wednesday (day 2)
    const daysWithLessons = [0, 1, 2, 3, 4].filter(d => (dayLessonMap[d] || []).length > 0);
    const teacherTargetDays = daysWithLessons.length > 0
      ? daysWithLessons
      : (teachingRole.schedulePreference?.days && teachingRole.schedulePreference.days.length > 0)
        ? teachingRole.schedulePreference.days
        : [2];

    const teacherFlexPerDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    if (totalWeeklyTeacherFlexMin > 0 && teacherTargetDays.length > 0) {
      const perDayFlex = Math.floor(totalWeeklyTeacherFlexMin / teacherTargetDays.length);
      let allocatedFlex = 0;
      teacherTargetDays.forEach((d, idx) => {
        if (d >= 0 && d <= 4) {
          const toAdd = idx === teacherTargetDays.length - 1 
            ? (totalWeeklyTeacherFlexMin - allocatedFlex) 
            : perDayFlex;
          allocatedFlex += toAdd;
          teacherFlexPerDay[d] = toAdd;
        }
      });
    }

    // Other non-teacher secondary roles allocation by days
    const secRolesPerDay: Record<number, { roleId: string; title: string; minutes: number }[]> = {
      0: [], 1: [], 2: [], 3: [], 4: []
    };

    sortedRoles.slice(1).forEach(secRole => {
      // If this secondary role is the teaching role, it is handled via contact lessons + teacherFlexPerDay
      if (secRole.id === lessonRoleId) return;

      const secTotalMin = (secRole.hours * 60) + secRole.minutes;
      if (secTotalMin <= 0) return;

      const pref = secRole.schedulePreference;
      let targetDays: number[] = [];

      if (pref?.days && pref.days.length > 0) {
        targetDays = pref.days;
      } else if (secTotalMin <= 240) {
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

    const rawTeacherSchedule = days.map((day, dayIndex) => {
      const slots: DaySlot[] = [];
      const dayTarget = dailyTargets[dayIndex];
      const lessonNumbers = dayLessonMap[dayIndex] || [];
      const secRolesForDay = secRolesPerDay[dayIndex] || [];
      const teacherFlexMinutes = teacherFlexPerDay[dayIndex] || 0;

      // CASE A: Day has contact lessons
      if (lessonNumbers.length > 0) {
        const firstLessonNum = lessonNumbers[0];
        const firstBell = STANDARD_LESSON_BELLS.find(b => b.number === firstLessonNum);
        const firstBellStartMin = firstBell ? timeToMinutes(firstBell.startTime) : startMin;

        // If the day starts before the first lesson (e.g. 08:00 vs lesson 1 at 08:30)
        // Primary role (or morning prep) works from startMin
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

        let currentClock = afternoonStartMin;

        // Place Teacher Flexible Hours for this day (exact calculated minutes)
        if (teacherFlexMinutes > 0) {
          let flexStart = currentClock;
          let flexEnd = flexStart + teacherFlexMinutes;

          const pref = teachingRole.schedulePreference;
          if (pref?.mode === 'custom_times' && pref.startTime && pref.days?.includes(dayIndex)) {
            flexStart = timeToMinutes(pref.startTime);
            flexEnd = flexStart + teacherFlexMinutes;
          }

          slots.push({
            id: `slot-${dayIndex}-teach-flex`,
            startTime: minutesToTime(flexStart),
            endTime: minutesToTime(flexEnd),
            type: 'work',
            roleId: lessonRoleId,
            isRemote: false,
            workCategory: 'flexible'
          });

          if (flexEnd > currentClock) {
            currentClock = flexEnd;
          }
        }

        // Place non-teacher secondary roles on this day
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
              workCategory: 'general'
            });

            if (slotEnd > currentClock) {
              currentClock = slotEnd;
            }
          }
        });

        // Place remaining flexible / work hours for primary role so that dayTarget is reached
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
        // Standard morning work for primary role
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

        let currentClock = targetLunchEndMin;

        // Place Teacher Flexible Hours if allocated to this day
        if (teacherFlexMinutes > 0) {
          let flexStart = currentClock;
          let flexEnd = flexStart + teacherFlexMinutes;

          const pref = teachingRole.schedulePreference;
          if (pref?.mode === 'custom_times' && pref.startTime && (pref.days?.includes(dayIndex) || !pref.days || pref.days.length === 0)) {
            flexStart = timeToMinutes(pref.startTime);
            flexEnd = flexStart + teacherFlexMinutes;
          }

          slots.push({
            id: `slot-${dayIndex}-teach-flex`,
            startTime: minutesToTime(flexStart),
            endTime: minutesToTime(flexEnd),
            type: 'work',
            roleId: lessonRoleId,
            isRemote: false,
            workCategory: 'flexible'
          });

          if (flexEnd > currentClock) {
            currentClock = flexEnd;
          }
        }

        // Schedule non-teacher secondary roles with exact entered minutes
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
              workCategory: 'general'
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
      } else {
        // No lunch break: continuous work starting strictly at startTime (08:00)
        let currentClock = startMin;

        if (teacherFlexMinutes > 0) {
          slots.push({
            id: `slot-${dayIndex}-teach-flex`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + teacherFlexMinutes),
            type: 'work',
            roleId: lessonRoleId,
            isRemote: false,
            workCategory: 'flexible'
          });
          currentClock += teacherFlexMinutes;
        }

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
              workCategory: 'general'
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

    return reconcileScheduleWithRoleTargets(rawTeacherSchedule, roles);
  }

  // 2. STANDARD NON-TEACHER SCHEDULE (strictly starts at startTime = 08:00, respects day targets)
  let roleQueue = sortedRoles.map(r => ({
    id: r.id,
    remaining: (r.hours * 60) + r.minutes
  }));

  const rawStandardSchedule = days.map((day, dayIndex) => {
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

  return reconcileScheduleWithRoleTargets(rawStandardSchedule, roles);
};

