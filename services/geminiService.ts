import { GoogleGenAI, Type } from "@google/genai";
import { DaySchedule, JobRole, DaySlot, ExternalWorkplace, WeekdayLessons, WorkCategory } from "../types";
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
  const lunchDur = (hasLunch && lunchDuration > 0) ? (targetLunchEndMin - targetLunchStartMin) : 0;

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

  // Check if role title contains teacher/pedagogical terms
  const isTitlePedagogical = (title: string): boolean => {
    const t = (title || '').toLowerCase().trim();
    return t.includes('mokyt') || t.includes('pamok') || t.includes('pedagog') || t.includes('auklėtoj') || t.includes('ugd') || t.includes('dėst');
  };

  // Identify teaching role
  const teacherRole = getSlotTeacherRole(roles);

  // Parse contact lessons
  const isLessonsExplicitlyProvided = weeklyLessons !== undefined;
  const dayLessonMap: Record<number, number[]> = {};
  let totalWeeklyTeacherLessons = 0;

  days.forEach((_, dayIndex) => {
    if (isLessonsExplicitlyProvided && weeklyLessons) {
      dayLessonMap[dayIndex] = [...(weeklyLessons[dayIndex] || [])].sort((a, b) => a - b);
    } else {
      // Default lessons only if isTeacher is true, weeklyLessons is completely undefined, AND there is a teacher role
      dayLessonMap[dayIndex] = (isTeacher && teacherRole) ? (dayIndex === 4 ? [1, 2, 3] : [1, 2, 3, 4]) : [];
    }
    totalWeeklyTeacherLessons += (dayLessonMap[dayIndex] || []).length;
  });

  // Determine whether to run in contact lesson mode:
  // ONLY if isTeacher is true, there are actual contact lessons (> 0), and an active teaching role is found.
  const activeTeachingRole = teacherRole || (totalWeeklyTeacherLessons > 0 ? primaryRole : undefined);
  const isLessonMode = isTeacher && totalWeeklyTeacherLessons > 0 && activeTeachingRole !== undefined;

  // =========================================================================
  // SCENARIO 1: STANDARD WORK SCHEDULE (No contact lessons: e.g. 40h Direktorius,
  // or any teacher/specialist during non-contact weeks)
  // =========================================================================
  if (!isLessonMode) {
    const secRolesPerDay: Record<number, { roleId: string; title: string; minutes: number }[]> = {
      0: [], 1: [], 2: [], 3: [], 4: []
    };

    // Secondary roles allocation
    sortedRoles.slice(1).forEach(secRole => {
      const secTotalMin = (secRole.hours * 60) + secRole.minutes;
      if (secTotalMin <= 0) return;

      const pref = secRole.schedulePreference;
      const targetDays = (pref?.days && pref.days.length > 0)
        ? pref.days
        : (secTotalMin <= 240 ? [2] : [0, 1, 2, 3, 4]);

      const minPerDay = Math.floor(secTotalMin / targetDays.length);
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

    // Primary role target minutes & working days
    const primaryTotalMin = primaryRole ? ((primaryRole.hours * 60) + primaryRole.minutes) : 0;
    const primaryPrefDays = primaryRole?.schedulePreference?.days;
    const primaryDays = (primaryPrefDays && primaryPrefDays.length > 0)
      ? primaryPrefDays
      : [0, 1, 2, 3, 4];

    const primaryMinutesPerDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };

    if (primaryTotalMin > 0 && primaryDays.length > 0) {
      // Allocate primary minutes as dayTarget - secondary minutes
      let sumAllocated = 0;
      primaryDays.forEach(d => {
        const secToday = secRolesPerDay[d].reduce((s, r) => s + r.minutes, 0);
        const dayWork = Math.max(0, dailyTargets[d] - secToday);
        primaryMinutesPerDay[d] = dayWork;
        sumAllocated += dayWork;
      });

      // Adjust any difference so sum equals primaryTotalMin exactly
      const diff = primaryTotalMin - sumAllocated;
      if (diff !== 0) {
        const perDay = Math.floor(diff / primaryDays.length);
        let rem = diff % primaryDays.length;
        primaryDays.forEach(d => {
          let adj = primaryMinutesPerDay[d] + perDay;
          if (rem > 0) { adj++; rem--; }
          else if (rem < 0) { adj--; rem++; }
          primaryMinutesPerDay[d] = Math.max(0, adj);
        });
      }
    }

    const schedule = days.map((day, dayIndex) => {
      const slots: DaySlot[] = [];
      const primaryMinToday = primaryMinutesPerDay[dayIndex] || 0;
      const secToday = secRolesPerDay[dayIndex] || [];
      const totalDayWork = primaryMinToday + secToday.reduce((s, r) => s + r.minutes, 0);

      if (totalDayWork <= 0) {
        return {
          id: `day-${dayIndex}`,
          dayName: day,
          dateOffset: dayIndex,
          slots: []
        };
      }

      const isPrimaryTeacher = isTitlePedagogical(primaryRole?.title || '');
      const primaryWorkCat: WorkCategory = isPrimaryTeacher ? 'flexible' : 'general';

      const shouldHaveLunch = hasLunch && lunchDur > 0 && totalDayWork >= 240;

      if (shouldHaveLunch) {
        // Morning work for primary role: strictly from startTime (08:00) to lunchStartTime (12:30)
        const morningWork = Math.min(Math.max(0, targetLunchStartMin - startMin), primaryMinToday);
        if (morningWork > 0) {
          slots.push({
            id: `slot-${dayIndex}-morn`,
            startTime: minutesToTime(startMin),
            endTime: minutesToTime(startMin + morningWork),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: primaryWorkCat
          });
        }

        // Lunch break strictly at target lunch times (e.g. 12:30 - 13:00)
        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: minutesToTime(targetLunchStartMin),
          endTime: minutesToTime(targetLunchEndMin),
          type: 'break',
          roleId: '',
          isRemote: false
        });

        let currentClock = targetLunchEndMin;

        // Place secondary roles if any
        secToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            const secTargetRole = roles.find(r => r.id === sec.roleId);
            const isSecTeacher = isTitlePedagogical(secTargetRole?.title || '');
            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + sec.minutes),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: isSecTeacher ? 'flexible' : 'general'
            });
            currentClock += sec.minutes;
          }
        });

        // Afternoon work for primary role to fulfill today's quota
        const afternoonNeeded = Math.max(0, primaryMinToday - morningWork);
        if (afternoonNeeded > 0) {
          slots.push({
            id: `slot-${dayIndex}-aft`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + afternoonNeeded),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: primaryWorkCat
          });
        }
      } else {
        // No lunch break: continuous work starting strictly at startTime (08:00)
        let currentClock = startMin;

        if (primaryMinToday > 0) {
          slots.push({
            id: `slot-${dayIndex}-work`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + primaryMinToday),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: primaryWorkCat
          });
          currentClock += primaryMinToday;
        }

        secToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            const secTargetRole = roles.find(r => r.id === sec.roleId);
            const isSecTeacher = isTitlePedagogical(secTargetRole?.title || '');
            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + sec.minutes),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: isSecTeacher ? 'flexible' : 'general'
            });
            currentClock += sec.minutes;
          }
        });
      }

      return {
        id: `day-${dayIndex}`,
        dayName: day,
        dateOffset: dayIndex,
        slots: sortSlots(slots)
      };
    });

    return reconcileScheduleWithRoleTargets(schedule, roles);
  }

  // =========================================================================
  // SCENARIO 2: TEACHER WITH CONTACT LESSONS (1 lesson = 60 min. accounted load)
  // =========================================================================
  const teachingRoleId = activeTeachingRole.id;
  const isTeacherPrimary = teachingRoleId === primaryRoleId;

  // Secondary roles allocation
  const secRolesPerDay: Record<number, { roleId: string; title: string; minutes: number }[]> = {
    0: [], 1: [], 2: [], 3: [], 4: []
  };

  sortedRoles.slice(1).forEach(secRole => {
    if (secRole.id === teachingRoleId) return;

    const secTotalMin = (secRole.hours * 60) + secRole.minutes;
    if (secTotalMin <= 0) return;

    const pref = secRole.schedulePreference;
    const targetDays = (pref?.days && pref.days.length > 0)
      ? pref.days
      : (secTotalMin <= 240 ? [2] : [0, 1, 2, 3, 4]);

    const minPerDay = Math.floor(secTotalMin / targetDays.length);
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

  const teacherSchedule = days.map((day, dayIndex) => {
    const slots: DaySlot[] = [];
    const lessonNumbers = dayLessonMap[dayIndex] || [];
    const secToday = secRolesPerDay[dayIndex] || [];
    const secMinToday = secToday.reduce((s, r) => s + r.minutes, 0);

    const dayTarget = dailyTargets[dayIndex];
    const availableForTeacherToday = Math.max(0, dayTarget - secMinToday);

    if (isTeacherPrimary) {
      // The teacher IS the primary role
      const todayLessonAccMin = lessonNumbers.length * 60;
      let todayFlexMin = Math.max(0, availableForTeacherToday - todayLessonAccMin);

      if (lessonNumbers.length > 0) {
        const firstLessonNum = lessonNumbers[0];
        const firstBell = STANDARD_LESSON_BELLS.find(b => b.number === firstLessonNum);
        const firstBellStartMin = firstBell ? timeToMinutes(firstBell.startTime) : startMin;

        // Morning prep before first lesson (e.g. 08:00 - 08:30)
        let morningPrep = 0;
        if (firstBellStartMin > startMin && todayFlexMin > 0) {
          morningPrep = Math.min(firstBellStartMin - startMin, todayFlexMin);
          if (morningPrep > 0) {
            slots.push({
              id: `slot-${dayIndex}-morn-prep`,
              startTime: minutesToTime(startMin),
              endTime: minutesToTime(startMin + morningPrep),
              type: 'work',
              roleId: teachingRoleId,
              isRemote: false,
              workCategory: 'flexible'
            });
            todayFlexMin -= morningPrep;
          }
        }

        // Contact lessons
        lessonNumbers.forEach(num => {
          const bell = STANDARD_LESSON_BELLS.find(b => b.number === num);
          if (bell) {
            slots.push({
              id: `slot-${dayIndex}-lesson-${num}`,
              startTime: bell.startTime,
              endTime: bell.endTime,
              type: 'work',
              roleId: teachingRoleId,
              isRemote: false,
              workCategory: 'lesson',
              lessonNumber: num
            });
          }
        });

        const lastLessonNum = lessonNumbers[lessonNumbers.length - 1];
        const lastBell = STANDARD_LESSON_BELLS.find(b => b.number === lastLessonNum);
        const lastLessonEndMin = lastBell ? timeToMinutes(lastBell.endTime) : targetLunchStartMin;

        // Lunch break
        let afternoonStart = lastLessonEndMin;
        if (hasLunch && lunchDur > 0) {
          let lunchStartM = targetLunchStartMin;
          let lunchEndM = targetLunchEndMin;
          if (lastLessonEndMin >= targetLunchStartMin) {
            lunchStartM = lastLessonEndMin;
            lunchEndM = lunchStartM + lunchDur;
          }
          slots.push({
            id: `slot-${dayIndex}-br`,
            startTime: minutesToTime(lunchStartM),
            endTime: minutesToTime(lunchEndM),
            type: 'break',
            roleId: '',
            isRemote: false
          });
          afternoonStart = lunchEndM;
        }

        let currentClock = afternoonStart;

        // Afternoon flex hours
        if (todayFlexMin > 0) {
          slots.push({
            id: `slot-${dayIndex}-teach-flex`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + todayFlexMin),
            type: 'work',
            roleId: teachingRoleId,
            isRemote: false,
            workCategory: 'flexible'
          });
          currentClock += todayFlexMin;
        }

        // Secondary roles
        secToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + sec.minutes),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: 'general'
            });
            currentClock += sec.minutes;
          }
        });
      } else {
        // Zero lessons today for teacher: standard workday
        const shouldHaveLunch = hasLunch && lunchDur > 0 && availableForTeacherToday >= 240;
        if (shouldHaveLunch) {
          const morningWork = Math.min(Math.max(0, targetLunchStartMin - startMin), availableForTeacherToday);
          if (morningWork > 0) {
            slots.push({
              id: `slot-${dayIndex}-morn`,
              startTime: minutesToTime(startMin),
              endTime: minutesToTime(startMin + morningWork),
              type: 'work',
              roleId: teachingRoleId,
              isRemote: false,
              workCategory: 'flexible'
            });
          }

          slots.push({
            id: `slot-${dayIndex}-br`,
            startTime: minutesToTime(targetLunchStartMin),
            endTime: minutesToTime(targetLunchEndMin),
            type: 'break',
            roleId: '',
            isRemote: false
          });

          let currentClock = targetLunchEndMin;

          secToday.forEach((sec, sIdx) => {
            if (sec.minutes > 0) {
              slots.push({
                id: `slot-${dayIndex}-sec-${sIdx}`,
                startTime: minutesToTime(currentClock),
                endTime: minutesToTime(currentClock + sec.minutes),
                type: 'work',
                roleId: sec.roleId,
                isRemote: false,
                workCategory: 'general'
              });
              currentClock += sec.minutes;
            }
          });

          const afternoonNeeded = Math.max(0, availableForTeacherToday - morningWork);
          if (afternoonNeeded > 0) {
            slots.push({
              id: `slot-${dayIndex}-aft`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + afternoonNeeded),
              type: 'work',
              roleId: teachingRoleId,
              isRemote: false,
              workCategory: 'flexible'
            });
          }
        } else {
          let currentClock = startMin;
          if (availableForTeacherToday > 0) {
            slots.push({
              id: `slot-${dayIndex}-work`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + availableForTeacherToday),
              type: 'work',
              roleId: teachingRoleId,
              isRemote: false,
              workCategory: 'flexible'
            });
            currentClock += availableForTeacherToday;
          }
          secToday.forEach((sec, sIdx) => {
            if (sec.minutes > 0) {
              slots.push({
                id: `slot-${dayIndex}-sec-${sIdx}`,
                startTime: minutesToTime(currentClock),
                endTime: minutesToTime(currentClock + sec.minutes),
                type: 'work',
                roleId: sec.roleId,
                isRemote: false,
                workCategory: 'general'
              });
              currentClock += sec.minutes;
            }
          });
        }
      }
    } else {
      // Teaching role is a SECONDARY role
      const hasLessonsToday = lessonNumbers.length > 0;
      let teacherMinutesToday = 0;

      if (hasLessonsToday) {
        lessonNumbers.forEach(num => {
          const bell = STANDARD_LESSON_BELLS.find(b => b.number === num);
          if (bell) {
            slots.push({
              id: `slot-${dayIndex}-lesson-${num}`,
              startTime: bell.startTime,
              endTime: bell.endTime,
              type: 'work',
              roleId: teachingRoleId,
              isRemote: false,
              workCategory: 'lesson',
              lessonNumber: num
            });
            teacherMinutesToday += 60;
          }
        });
      }

      const primaryMinToday = Math.max(0, dayTarget - teacherMinutesToday - secMinToday);
      const shouldHaveLunch = hasLunch && lunchDur > 0 && dayTarget >= 240;

      if (shouldHaveLunch) {
        const morningPrimary = Math.min(Math.max(0, targetLunchStartMin - startMin), primaryMinToday);
        if (morningPrimary > 0) {
          slots.push({
            id: `slot-${dayIndex}-morn`,
            startTime: minutesToTime(startMin),
            endTime: minutesToTime(startMin + morningPrimary),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: isTitlePedagogical(primaryRole?.title || '') ? 'flexible' : 'general'
          });
        }

        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: minutesToTime(targetLunchStartMin),
          endTime: minutesToTime(targetLunchEndMin),
          type: 'break',
          roleId: '',
          isRemote: false
        });

        let currentClock = targetLunchEndMin;

        const afternoonPrimary = Math.max(0, primaryMinToday - morningPrimary);
        if (afternoonPrimary > 0) {
          slots.push({
            id: `slot-${dayIndex}-aft`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + afternoonPrimary),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: isTitlePedagogical(primaryRole?.title || '') ? 'flexible' : 'general'
          });
          currentClock += afternoonPrimary;
        }

        secToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + sec.minutes),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: 'general'
            });
            currentClock += sec.minutes;
          }
        });
      } else {
        let currentClock = startMin;
        if (primaryMinToday > 0) {
          slots.push({
            id: `slot-${dayIndex}-work`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + primaryMinToday),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: isTitlePedagogical(primaryRole?.title || '') ? 'flexible' : 'general'
          });
          currentClock += primaryMinToday;
        }
        secToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            slots.push({
              id: `slot-${dayIndex}-sec-${sIdx}`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + sec.minutes),
              type: 'work',
              roleId: sec.roleId,
              isRemote: false,
              workCategory: 'general'
            });
            currentClock += sec.minutes;
          }
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

  return reconcileScheduleWithRoleTargets(teacherSchedule, roles);
};

