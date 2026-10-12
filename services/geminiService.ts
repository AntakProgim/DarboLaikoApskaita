import { GoogleGenAI, Type } from "@google/genai";
import { DaySchedule, JobRole, DaySlot, ExternalWorkplace, WeekdayLessons } from "../types";
import { timeToMinutes, minutesToTime, roundToNearest5, STANDARD_LESSON_BELLS, sortSlots, PEDAGOGICAL_DAILY_LIMIT_MINUTES } from "../utils/timeHelper";

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
  weeklyLessons?: WeekdayLessons
): Promise<DaySchedule[]> => {
  const ai = getAiClient();
  const targetHours = totalWeeklyMinutes / 60;

  // Prioritize primary role (first role with highest workload)
  const rolesDescription = roles
    .map((r, i) => `${i === 0 ? '[PAGRINDINĖS PAREIGOS] ' : '[PAPILDOMOS PAREIGOS] '}${r.title} (ID: ${r.id}, Trukmė: ${r.hours}h ${r.minutes}m)`)
    .join(', ');

  const hasSpecificLessons = weeklyLessons && Object.values(weeklyLessons).some(arr => arr && arr.length > 0);
    
  if (!ai || hasSpecificLessons) {
    // If specific weekly lessons were configured or AI is unavailable, use the deterministic rule engine
    return generateSimpleSchedule(roles, totalWeeklyMinutes, startTime, lunchDuration, lunchStartTime, lunchEndTime, hasLunch, isTeacher, weeklyLessons);
  }

  try {
    const lunchRule = hasLunch && lunchDuration > 0
      ? `3. When daily work is more than 4 hours, schedule a lunch 'break' slot strictly from ${lunchStartTime} to ${lunchEndTime} (or ${lunchDuration} minutes). Lunch break is NOT counted towards working hours.`
      : `3. Do NOT include any lunch or break slots.`;

    const teacherRule = isTeacher
      ? `8. TEACHER / SPECIALIST WORK RULES:
      - The first role is the primary duty with the highest workload.
      - First, schedule contact lesson periods during standard school hours (e.g. 08:00-08:45, 08:55-09:40, 09:50-10:35, 10:55-11:40, 12:00-12:45, 12:55-13:40). Set workCategory to 'lesson' and assign appropriate lesson numbers.
      - Next, allocate flexible non-contact hours (pasiruošimas, metodinė veikla) strictly outside lesson hours (e.g. after lessons). Set workCategory to 'flexible'.
      - Then arrange other secondary duties (if any) around lesson times.
      - Daily pedagogical work must NEVER exceed 10 hours 18 minutes (618 minutes), and total daily work must never exceed 12 hours.`
      : ``;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Create a weekly work schedule (Monday to Friday) based on these roles: [${rolesDescription}].
      
      Total target working hours: ${targetHours.toFixed(2)}.
      
      Rules:
      1. Return a list of 5 days (Monday - Friday).
      2. Start the work day at ${startTime} (unless logic dictates otherwise).
      ${lunchRule}
      4. Distribute the roles strictly according to their assigned duration.
      5. Do NOT count break time towards the total working hours.
      6. By default, work slots are NOT remote (isRemote: false).
      7. Use the exact 'roleId' provided in the description for each slot.
      ${teacherRule}
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              dayName: { type: Type.STRING },
              slots: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startTime: { type: Type.STRING },
                    endTime: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ["work", "break", "external"] },
                    roleId: { type: Type.STRING },
                    roleName: { type: Type.STRING },
                    isRemote: { type: Type.BOOLEAN },
                    workCategory: { type: Type.STRING, enum: ["lesson", "flexible", "general"] },
                    lessonNumber: { type: Type.INTEGER }
                  },
                  required: ["startTime", "endTime", "type", "roleId", "roleName"]
                }
              }
            },
            required: ["dayName", "slots"]
          }
        }
      }
    });

    const rawData = JSON.parse(response.text || "[]");
    const days = ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis"];
    
    return rawData.map((item: any, index: number) => {
      const slots: DaySlot[] = (item.slots || []).map((s: any, sIdx: number) => {
        let matchedRole = roles.find(r => r.id === s.roleId);
        if (!matchedRole && s.roleName) {
            matchedRole = roles.find(r => r.title.toLowerCase().trim() === s.roleName.toLowerCase().trim() ||
                                          s.roleName.toLowerCase().includes(r.title.toLowerCase().trim()) ||
                                          r.title.toLowerCase().includes(s.roleName.toLowerCase().trim()));
        }
        if (!matchedRole) matchedRole = roles[0];
        
        return {
          id: `slot-${index}-${sIdx}`,
          startTime: roundToNearest5(s.startTime),
          endTime: roundToNearest5(s.endTime),
          type: s.type === 'break' ? 'break' : s.type === 'external' ? 'external' : 'work',
          roleId: matchedRole ? matchedRole.id : "",
          isRemote: !!s.isRemote,
          workCategory: s.workCategory || (isTeacher ? 'lesson' : 'general'),
          lessonNumber: s.lessonNumber
        };
      });

      return {
        id: `day-${index}`,
        dayName: days[index] || item.dayName,
        dateOffset: index,
        slots: slots
      };
    });

  } catch (error) {
    console.error("Gemini generation failed, using fallback rule engine:", error);
    return generateSimpleSchedule(roles, totalWeeklyMinutes, startTime, lunchDuration, lunchStartTime, lunchEndTime, hasLunch, isTeacher, weeklyLessons);
  }
};

const generateSimpleSchedule = (
    roles: JobRole[], 
    totalWeeklyMinutes: number, 
    startTime: string,
    lunchDuration: number,
    lunchStartTime: string = "12:00",
    lunchEndTime: string = "12:30",
    hasLunch: boolean = true,
    isTeacher: boolean = false,
    weeklyLessons?: WeekdayLessons
): DaySchedule[] => {
  const days = ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis"];
  const startMin = timeToMinutes(startTime);
  const targetLunchStartMin = timeToMinutes(lunchStartTime);
  let targetLunchEndMin = timeToMinutes(lunchEndTime);
  if (targetLunchEndMin <= targetLunchStartMin) {
    targetLunchEndMin = targetLunchStartMin + (lunchDuration || 30);
  }
  const effectiveLunchDuration = targetLunchEndMin - targetLunchStartMin;

  // Sort roles descending so the primary role with highest workload is processed first
  const sortedRoles = [...roles].sort((a, b) => {
    const minA = a.hours * 60 + a.minutes;
    const minB = b.hours * 60 + b.minutes;
    return minB - minA;
  });

  const primaryRole = sortedRoles[0];
  const primaryRoleId = primaryRole ? primaryRole.id : '1';
  const primaryRoleTotalMin = primaryRole ? (primaryRole.hours * 60 + primaryRole.minutes) : totalWeeklyMinutes;

  // Secondary roles queue
  let secondaryRolesQueue = sortedRoles.slice(1).map(r => ({
    id: r.id,
    title: r.title,
    remainingMin: r.hours * 60 + r.minutes
  }));

  // If teacher or assistance specialist mode
  if (isTeacher) {
    const hasCustomLessons = weeklyLessons && Object.values(weeklyLessons).some(l => l && l.length > 0);
    
    // Calculate total contact lesson minutes across the week
    // Mokytojui pamokos laikas skaičiuojamas valandomis (1 pamoka = 60 min.), nors pamoka trunka 45 min.
    let totalScheduledLessonMinutes = 0;
    if (hasCustomLessons && weeklyLessons) {
      Object.values(weeklyLessons).forEach(list => {
        if (list) totalScheduledLessonMinutes += list.length * 60; // 60 min per lesson
      });
    } else {
      totalScheduledLessonMinutes = Math.min(primaryRoleTotalMin, 20 * 60);
    }

    // Remaining flexible / non-contact minutes for primary role (pasiruošimas, metodinė veikla)
    const remainingFlexibleMinutes = Math.max(0, primaryRoleTotalMin - totalScheduledLessonMinutes);
    const flexMinPerDay = Math.round(remainingFlexibleMinutes / 5);
    let flexAllocatedTotal = 0;

    return days.map((day, dayIndex) => {
      const slots: DaySlot[] = [];
      let dayWorkMin = 0;

      // 1. First: place contact lessons for this weekday
      let dayLessonNumbers: number[] = [];
      if (hasCustomLessons && weeklyLessons) {
        dayLessonNumbers = weeklyLessons[dayIndex] || [];
      } else {
        // Default 4 lessons on Mon-Thu, 3 on Fri
        dayLessonNumbers = dayIndex === 4 ? [1, 2, 3] : [1, 2, 3, 4];
      }

      // Add each lesson (bell is 45 min, but counts as 1 hour in work accounting)
      dayLessonNumbers.sort((a, b) => a - b).forEach(num => {
        const bell = STANDARD_LESSON_BELLS.find(b => b.number === num);
        if (bell) {
          slots.push({
            id: `slot-${dayIndex}-lesson-${num}`,
            startTime: bell.startTime,
            endTime: bell.endTime,
            type: 'work',
            roleId: primaryRoleId,
            isRemote: false,
            workCategory: 'lesson',
            lessonNumber: num
          });
          dayWorkMin += 60; // 1 pamoka = 60 min darbo laiko normos
        }
      });

      // Insert lunch break if lessons span across midday
      if (hasLunch && lunchDuration > 0 && dayLessonNumbers.length >= 4) {
        slots.push({
          id: `slot-${dayIndex}-br`,
          startTime: lunchStartTime,
          endTime: lunchEndTime,
          type: 'break',
          roleId: '',
          isRemote: false
        });
      }

      // 2. Next: schedule flexible / non-contact hours for primary role OUTSIDE lessons
      let flexForThisDay = flexMinPerDay;
      if (dayIndex === 4) {
        flexForThisDay = Math.max(0, remainingFlexibleMinutes - flexAllocatedTotal);
      }
      flexAllocatedTotal += flexForThisDay;

      let nextAvailableStart = "14:00";
      const workSlots = slots.filter(s => s.type === 'work');
      if (workSlots.length > 0) {
        const lastWork = workSlots[workSlots.length - 1];
        nextAvailableStart = lastWork.endTime;
      }

      if (flexForThisDay > 0) {
        const flexStartMin = timeToMinutes(nextAvailableStart) + 10;
        const flexEndMin = flexStartMin + flexForThisDay;

        slots.push({
          id: `slot-${dayIndex}-flex`,
          startTime: minutesToTime(flexStartMin),
          endTime: minutesToTime(flexEndMin),
          type: 'work',
          roleId: primaryRoleId,
          isRemote: false,
          workCategory: 'flexible'
        });

        nextAvailableStart = minutesToTime(flexEndMin);
        dayWorkMin += flexForThisDay;
      }

      // 3. Next: Secondary duties (mažesnės pareigos)
      // Pagal reikalavimą: mažesnių pareigų laikus leidžiama nurodyti vartotojui pačiam arba sudėlioti automatiškai
      sortedRoles.slice(1).forEach(secRole => {
        const pref = secRole.schedulePreference;
        const secRoleTotalMin = (secRole.hours * 60) + secRole.minutes;

        if (pref?.mode === 'custom_times' && pref.days && pref.days.includes(dayIndex) && pref.startTime && pref.endTime) {
          // Vartotojas nurodė konkrečias dienas ir laiką šioms mažesnėms pareigoms
          slots.push({
            id: `slot-${dayIndex}-sec-${secRole.id}`,
            startTime: pref.startTime,
            endTime: pref.endTime,
            type: 'work',
            roleId: secRole.id,
            isRemote: false,
            workCategory: 'general'
          });
        } else if (!pref || pref.mode === 'auto_after_lessons') {
          // Sudėlioti automatiškai po pamokų / po lanksčių valandų
          const dailyMin = Math.round(secRoleTotalMin / 5);
          if (dailyMin > 0) {
            const secStartMin = timeToMinutes(nextAvailableStart) > 0 ? timeToMinutes(nextAvailableStart) : 14 * 60 + 40;
            const secEndMin = secStartMin + dailyMin;
            slots.push({
              id: `slot-${dayIndex}-sec-${secRole.id}`,
              startTime: minutesToTime(secStartMin),
              endTime: minutesToTime(secEndMin),
              type: 'work',
              roleId: secRole.id,
              isRemote: false,
              workCategory: 'general'
            });
            nextAvailableStart = minutesToTime(secEndMin);
            dayWorkMin += dailyMin;
          }
        }
        // Jeigu 'manual_in_schedule' – vartotojas susidėlios pats kortelėse naudodamas mygtukus
      });

      return {
        id: `day-${dayIndex}`,
        dayName: day,
        dateOffset: dayIndex,
        slots: sortSlots(slots)
      };
    });
  }

  // Standard non-teacher schedule generator
  const dailyMinutesTarget = totalWeeklyMinutes / 5;
  let roleQueue = sortedRoles.map(r => ({
      id: r.id,
      remaining: (r.hours * 60) + r.minutes
  }));

  return days.map((day, dayIndex) => {
    const slots: DaySlot[] = [];
    let currentClock = startMin;
    let dayWorkMinutes = 0;
    let hasBreak = false;
    const shouldHaveLunch = hasLunch && lunchDuration > 0 && dailyMinutesTarget >= 180;

    while (dayWorkMinutes < dailyMinutesTarget) {
        if (shouldHaveLunch && !hasBreak && currentClock >= targetLunchStartMin) {
            slots.push({
                id: `slot-${dayIndex}-br`,
                startTime: minutesToTime(currentClock),
                endTime: minutesToTime(currentClock + effectiveLunchDuration),
                type: 'break',
                roleId: '',
                isRemote: false
            });
            currentClock += effectiveLunchDuration;
            hasBreak = true;
        }

        const activeRoleIndex = roleQueue.findIndex(r => r.remaining > 0);
        if (activeRoleIndex === -1) break;

        const activeRole = roleQueue[activeRoleIndex];
        const remainingForDay = dailyMinutesTarget - dayWorkMinutes;
        
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

        if (shouldHaveLunch && !hasBreak && currentClock >= targetLunchStartMin) {
            slots.push({
                id: `slot-${dayIndex}-br`,
                startTime: minutesToTime(currentClock),
                endTime: minutesToTime(currentClock + effectiveLunchDuration),
                type: 'break',
                roleId: '',
                isRemote: false
            });
            currentClock += effectiveLunchDuration;
            hasBreak = true;
        }
    }

    return {
      id: `day-${dayIndex}`,
      dayName: day,
      dateOffset: dayIndex,
      slots: sortSlots(slots)
    };
  });
};
