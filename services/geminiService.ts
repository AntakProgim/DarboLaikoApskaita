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
    const daysWithLessons = [0, 1, 2, 3, 4].filter(d => (dayLessonMap[d] || []).length > 0);
    const prefFlexDist = teachingRole.schedulePreference?.flexibleDistribution || 'after_lessons';
    const prefFlexDays = teachingRole.schedulePreference?.flexibleDays;
    const prefDays = teachingRole.schedulePreference?.days;

    let teacherTargetDays: number[];
    if (prefFlexDist === 'after_lessons' && daysWithLessons.length > 0) {
      teacherTargetDays = daysWithLessons;
    } else if (prefFlexDays && prefFlexDays.length > 0) {
      teacherTargetDays = prefFlexDays;
    } else if (daysWithLessons.length > 0) {
      teacherTargetDays = daysWithLessons;
    } else if (prefDays && prefDays.length > 0) {
      teacherTargetDays = prefDays;
    } else {
      teacherTargetDays = [2]; // Wednesday default
    }

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

    // Check which days primary role works
    const primaryPrefDays = primaryRole?.schedulePreference?.days;
    const primaryDays = primaryPrefDays && primaryPrefDays.length > 0 
      ? primaryPrefDays 
      : [0, 1, 2, 3, 4];

    // Compute primary role target minutes and pre-calculate daily allocation to prevent over/under budget
    const primaryTotalMin = primaryRole ? ((primaryRole.hours * 60) + primaryRole.minutes) : 0;
    const primaryMinutesPerDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };

    if (primaryTotalMin > 0 && primaryDays.length > 0) {
      // Step 1: Calculate other roles total accounted minutes on each day
      const otherMinPerDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
      days.forEach((_, dIdx) => {
        const lessonCount = (dayLessonMap[dIdx] || []).length;
        const lessonAccMin = lessonRoleId !== primaryRoleId ? (lessonCount * 60) : 0;
        const teacherFlex = lessonRoleId !== primaryRoleId ? (teacherFlexPerDay[dIdx] || 0) : 0;
        const secTotal = secRolesPerDay[dIdx].reduce((s, r) => s + r.minutes, 0);
        otherMinPerDay[dIdx] = lessonAccMin + teacherFlex + secTotal;
      });

      // Step 2: On each day where primary works, calculate ideal primary minutes = dayTarget - otherMin
      let allocatedPrimary = 0;
      const primaryCandidates: { dayIndex: number; target: number }[] = [];

      primaryDays.forEach(dIdx => {
        const ideal = Math.max(0, dailyTargets[dIdx] - otherMinPerDay[dIdx]);
        primaryCandidates.push({ dayIndex: dIdx, target: ideal });
        allocatedPrimary += ideal;
      });

      // Step 3: Rebalance primary minutes so their sum exactly equals primaryTotalMin
      const primaryDiff = primaryTotalMin - allocatedPrimary;
      if (primaryDiff !== 0 && primaryCandidates.length > 0) {
        // Distribute difference across primary days
        const adjustPerDay = Math.floor(primaryDiff / primaryCandidates.length);
        let remainder = primaryDiff % primaryCandidates.length;

        primaryCandidates.forEach((c) => {
          let adjusted = c.target + adjustPerDay;
          if (remainder > 0) {
            adjusted += 1;
            remainder--;
          } else if (remainder < 0) {
            adjusted -= 1;
            remainder++;
          }
          primaryMinutesPerDay[c.dayIndex] = Math.max(0, adjusted);
        });
      } else {
        primaryCandidates.forEach(c => {
          primaryMinutesPerDay[c.dayIndex] = c.target;
        });
      }
    }

    const rawTeacherSchedule = days.map((day, dayIndex) => {
      const slots: DaySlot[] = [];
      const dayTarget = dailyTargets[dayIndex];
      const lessonNumbers = dayLessonMap[dayIndex] || [];
      const secRolesForDay = secRolesPerDay[dayIndex] || [];
      const teacherFlexMinutes = teacherFlexPerDay[dayIndex] || 0;
      const primaryDailyMin = primaryMinutesPerDay[dayIndex] || 0;

      // CASE A: Day has contact lessons
      if (lessonNumbers.length > 0) {
        const firstLessonNum = lessonNumbers[0];
        const firstBell = STANDARD_LESSON_BELLS.find(b => b.number === firstLessonNum);
        const firstBellStartMin = firstBell ? timeToMinutes(firstBell.startTime) : startMin;

        // Morning work for primary role before lessons
        let morningWorkMinutes = 0;
        if (primaryDailyMin > 0 && firstBellStartMin > startMin) {
          morningWorkMinutes = Math.min(firstBellStartMin - startMin, primaryDailyMin);
          if (morningWorkMinutes > 0) {
            slots.push({
              id: `slot-${dayIndex}-morn-prep`,
              startTime: minutesToTime(startMin),
              endTime: minutesToTime(startMin + morningWorkMinutes),
              type: 'work',
              roleId: primaryRoleId,
              isRemote: false,
              workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
            });
          }
        }

        // Add contact lesson slots - assigned to lessonRoleId (the teacher role)
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

        let afternoonStartMin = lastLessonEndMin;

        // Insert lunch break if day has >= 4h of total work and lunch is configured
        const totalEstimatedWorkDay = morningWorkMinutes + (lessonNumbers.length * 60) + teacherFlexMinutes + (secRolesForDay.reduce((s, r) => s + r.minutes, 0));
        if (hasLunch && lunchDuration > 0 && totalEstimatedWorkDay >= 240) {
          let lunchStartM = targetLunchStartMin;
          let lunchEndM = targetLunchEndMin;

          if (lastLessonEndMin >= targetLunchStartMin) {
            // Lunch after last lesson
            lunchStartM = lastLessonEndMin;
            lunchEndM = lunchStartM + (lunchDuration || 30);
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

        // Place remaining morning / afternoon primary role hours ONLY if primary still has hours left for today
        const remainingPrimaryToday = Math.max(0, primaryDailyMin - morningWorkMinutes);
        if (remainingPrimaryToday > 0 && currentClock <= 16 * 60 + 30) {
          slots.push({
            id: `slot-${dayIndex}-flex-aft`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + remainingPrimaryToday),
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
      const hasOtherWorkToday = teacherFlexMinutes > 0 || secRolesForDay.some(r => r.minutes > 0);
      const totalDayWork = primaryDailyMin + teacherFlexMinutes + secRolesForDay.reduce((s, r) => s + r.minutes, 0);

      if (hasLunch && lunchDuration > 0 && totalDayWork >= 240) {
        // Morning work for primary role
        let morningWork = 0;
        if (primaryDailyMin > 0) {
          morningWork = Math.min(targetLunchStartMin - startMin, primaryDailyMin);
          if (morningWork > 0) {
            slots.push({
              id: `slot-${dayIndex}-morn`,
              startTime: minutesToTime(startMin),
              endTime: minutesToTime(startMin + morningWork),
              type: 'work',
              roleId: primaryRoleId,
              isRemote: false,
              workCategory: primaryRoleId === lessonRoleId ? 'flexible' : 'general'
            });
          }
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

        // Schedule remaining primary role hours (if primary works today)
        const afternoonPrimaryNeeded = Math.max(0, primaryDailyMin - morningWork);
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

        if (primaryDailyMin > 0) {
          slots.push({
            id: `slot-${dayIndex}-work`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + primaryDailyMin),
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

