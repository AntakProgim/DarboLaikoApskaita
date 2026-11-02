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

  // Check if role is pedagogical
  const isRolePedagogical = (role?: JobRole): boolean => {
    if (!role) return false;
    if (role.isPedagogical === false) return false;
    const t = (role.title || '').toLowerCase().trim();
    if (t.includes('direkt') || t.includes('vadov') || t.includes('administr') || t.includes('laborant') || t.includes('sekretor') || t.includes('valyt') || t.includes('buhalter') || t.includes('raštin') || t.includes('ūkved')) {
      return false;
    }
    if (role.isPedagogical === true) return true;
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
    const secRolesPerDay: Record<number, { roleId: string; title: string; minutes: number; placementPosition: 'before_primary' | 'after_primary' | 'custom_time' }[]> = {
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
            minutes: toAdd,
            placementPosition: pref?.placementPosition || 'after_primary'
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

      const isPrimaryTeacher = isRolePedagogical(primaryRole);
      const primaryWorkCat: WorkCategory = isPrimaryTeacher ? 'flexible' : 'general';

      // Separate secondary roles into morning (before primary) and afternoon (after primary)
      const secBeforeToday = secToday.filter(s => s.placementPosition === 'before_primary');
      const secAfterToday = secToday.filter(s => s.placementPosition !== 'before_primary');

      const shouldHaveLunch = hasLunch && lunchDur > 0 && totalDayWork >= 240;

      if (shouldHaveLunch) {
        let currentClock = startMin;

        // 1. Morning secondary roles (prieš pagrindinį darbą)
        secBeforeToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            const secTargetRole = roles.find(r => r.id === sec.roleId);
            const isSecTeacher = isRolePedagogical(secTargetRole);
            slots.push({
              id: `slot-${dayIndex}-sec-bef-${sIdx}`,
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

        // 2. Morning work for primary role: from currentClock to lunch (e.g. up to 12:30)
        const morningPrimaryAvailable = Math.max(0, targetLunchStartMin - currentClock);
        const morningWork = Math.min(morningPrimaryAvailable, primaryMinToday);
        if (morningWork > 0) {
          slots.push({
            id: `slot-${dayIndex}-morn`,
            startTime: minutesToTime(currentClock),
            endTime: minutesToTime(currentClock + morningWork),
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: primaryWorkCat
          });
          currentClock += morningWork;
        }

        // 3. Lunch break strictly at target lunch times or immediately after morning work
        const actualLunchStart = Math.max(currentClock, targetLunchStartMin);
        const actualLunchEnd = actualLunchStart + lunchDur;
        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: minutesToTime(actualLunchStart),
          endTime: minutesToTime(actualLunchEnd),
          type: 'break',
          roleId: '',
          isRemote: false
        });
        currentClock = actualLunchEnd;

        // 4. Afternoon work for primary role to fulfill today's quota
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
          currentClock += afternoonNeeded;
        }

        // 5. Afternoon secondary roles (po pagrindinio darbo)
        secAfterToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            const secTargetRole = roles.find(r => r.id === sec.roleId);
            const isSecTeacher = isRolePedagogical(secTargetRole);
            slots.push({
              id: `slot-${dayIndex}-sec-aft-${sIdx}`,
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
      } else {
        // No lunch break: continuous work starting strictly at startTime (08:00)
        let currentClock = startMin;

        // Morning secondary roles first
        secBeforeToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            const secTargetRole = roles.find(r => r.id === sec.roleId);
            const isSecTeacher = isRolePedagogical(secTargetRole);
            slots.push({
              id: `slot-${dayIndex}-sec-bef-${sIdx}`,
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

        secAfterToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            const secTargetRole = roles.find(r => r.id === sec.roleId);
            const isSecTeacher = isRolePedagogical(secTargetRole);
            slots.push({
              id: `slot-${dayIndex}-sec-aft-${sIdx}`,
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
  const secRolesPerDay: Record<number, { roleId: string; title: string; minutes: number; placementPosition: 'before_primary' | 'after_primary' | 'custom_time' }[]> = {
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
          minutes: toAdd,
          placementPosition: pref?.placementPosition || 'after_primary'
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

    const secBeforeToday = secToday.filter(s => s.placementPosition === 'before_primary');
    const secAfterToday = secToday.filter(s => s.placementPosition !== 'before_primary');
    const secBeforeTotalMin = secBeforeToday.reduce((s, r) => s + r.minutes, 0);

    if (isTeacherPrimary) {
      // The teacher IS the primary role
      const todayLessonAccMin = lessonNumbers.length * 60;
      let todayFlexMin = Math.max(0, availableForTeacherToday - todayLessonAccMin);

      if (lessonNumbers.length > 0) {
        const firstLessonNum = lessonNumbers[0];
        const firstBell = STANDARD_LESSON_BELLS.find(b => b.number === firstLessonNum);
        const firstBellStartMin = firstBell ? timeToMinutes(firstBell.startTime) : startMin;

        // 1. Morning secondary roles (prieš pagrindinį darbą / pamokas)
        if (secBeforeTotalMin > 0) {
          let mornSecStart = Math.min(startMin, firstBellStartMin - secBeforeTotalMin);
          if (firstBellStartMin - startMin >= secBeforeTotalMin) {
            mornSecStart = startMin;
          }
          let mClock = mornSecStart;
          secBeforeToday.forEach((sec, sIdx) => {
            if (sec.minutes > 0) {
              const secTargetRole = roles.find(r => r.id === sec.roleId);
              const isSecTeacher = isRolePedagogical(secTargetRole);
              slots.push({
                id: `slot-${dayIndex}-sec-bef-${sIdx}`,
                startTime: minutesToTime(mClock),
                endTime: minutesToTime(mClock + sec.minutes),
                type: 'work',
                roleId: sec.roleId,
                isRemote: false,
                workCategory: isSecTeacher ? 'flexible' : 'general'
              });
              mClock += sec.minutes;
            }
          });
        }

        // Morning prep before first lesson (e.g. 08:00 - 08:30) if no secondary before
        let morningPrep = 0;
        if (firstBellStartMin > startMin && todayFlexMin > 0 && secBeforeTotalMin === 0) {
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

        // Afternoon secondary roles (po pagrindinio darbo / pamokų)
        secAfterToday.forEach((sec, sIdx) => {
          if (sec.minutes > 0) {
            const secTargetRole = roles.find(r => r.id === sec.roleId);
            const isSecTeacher = isRolePedagogical(secTargetRole);
            slots.push({
              id: `slot-${dayIndex}-sec-aft-${sIdx}`,
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
      } else {
        // Zero lessons today for teacher: standard workday
        const shouldHaveLunch = hasLunch && lunchDur > 0 && availableForTeacherToday >= 240;
        if (shouldHaveLunch) {
          let currentClock = startMin;

          // Morning secondary roles first
          secBeforeToday.forEach((sec, sIdx) => {
            if (sec.minutes > 0) {
              const secTargetRole = roles.find(r => r.id === sec.roleId);
              const isSecTeacher = isRolePedagogical(secTargetRole);
              slots.push({
                id: `slot-${dayIndex}-sec-bef-${sIdx}`,
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

          // Morning teacher flex hours: from currentClock to lunch
          const morningTeacherAvailable = Math.max(0, targetLunchStartMin - currentClock);
          const morningWork = Math.min(morningTeacherAvailable, availableForTeacherToday);
          if (morningWork > 0) {
            slots.push({
              id: `slot-${dayIndex}-morn`,
              startTime: minutesToTime(currentClock),
              endTime: minutesToTime(currentClock + morningWork),
              type: 'work',
              roleId: teachingRoleId,
              isRemote: false,
              workCategory: 'flexible'
            });
            currentClock += morningWork;
          }

          const actualLunchStart = Math.max(currentClock, targetLunchStartMin);
          const actualLunchEnd = actualLunchStart + lunchDur;
          slots.push({
            id: `slot-${dayIndex}-br`,
            startTime: minutesToTime(actualLunchStart),
            endTime: minutesToTime(actualLunchEnd),
            type: 'break',
            roleId: '',
            isRemote: false
          });
          currentClock = actualLunchEnd;

          // Afternoon teacher flex hours
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
            currentClock += afternoonNeeded;
          }

          // Afternoon secondary roles
          secAfterToday.forEach((sec, sIdx) => {
            if (sec.minutes > 0) {
              const secTargetRole = roles.find(r => r.id === sec.roleId);
              const isSecTeacher = isRolePedagogical(secTargetRole);
              slots.push({
                id: `slot-${dayIndex}-sec-aft-${sIdx}`,
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
        } else {
          let currentClock = startMin;

          // Morning secondary roles first
          secBeforeToday.forEach((sec, sIdx) => {
            if (sec.minutes > 0) {
              const secTargetRole = roles.find(r => r.id === sec.roleId);
              const isSecTeacher = isRolePedagogical(secTargetRole);
              slots.push({
                id: `slot-${dayIndex}-sec-bef-${sIdx}`,
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

          secAfterToday.forEach((sec, sIdx) => {
            if (sec.minutes > 0) {
              const secTargetRole = roles.find(r => r.id === sec.roleId);
              const isSecTeacher = isRolePedagogical(secTargetRole);
              slots.push({
                id: `slot-${dayIndex}-sec-aft-${sIdx}`,
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
            workCategory: isRolePedagogical(primaryRole) ? 'flexible' : 'general'
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
            workCategory: isRolePedagogical(primaryRole) ? 'flexible' : 'general'
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
            workCategory: isRolePedagogical(primaryRole) ? 'flexible' : 'general'
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

