import { GoogleGenAI, Type } from "@google/genai";
import { DaySchedule, JobRole, DaySlot, ExternalWorkplace } from "../types";
import { timeToMinutes, minutesToTime, roundToNearest5, STANDARD_LESSON_BELLS, sortSlots } from "../utils/timeHelper";

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
  otherWorkplaces: ExternalWorkplace[] = []
): Promise<DaySchedule[]> => {
  const ai = getAiClient();
  const targetHours = totalWeeklyMinutes / 60;

  const rolesDescription = roles
    .map(r => `${r.title} (ID: ${r.id}, Duration: ${r.hours}h ${r.minutes}m)`)
    .join(', ');
    
  if (!ai) {
    console.warn("API Key not found, using fallback generator.");
    return generateSimpleSchedule(roles, totalWeeklyMinutes, startTime, lunchDuration, lunchStartTime, lunchEndTime, hasLunch, isTeacher);
  }

  try {
    const lunchRule = hasLunch && lunchDuration > 0
      ? `3. When daily work is more than 4 hours, schedule a lunch 'break' slot strictly from ${lunchStartTime} to ${lunchEndTime} (or ${lunchDuration} minutes). Lunch break is NOT counted towards working hours.`
      : `3. Do NOT include any lunch or break slots.`;

    const teacherRule = isTeacher
      ? `8. TEACHER / PEDAGOGICAL WORK RULES:
      - The user is a school teacher.
      - First, schedule contact lesson periods during standard school hours (e.g. 08:00-08:45, 08:55-09:40, 09:50-10:35, 10:55-11:40, 12:00-12:45, 12:55-13:40). Set workCategory to 'lesson' and assign appropriate lesson numbers.
      - Next, allocate flexible non-contact hours (pasiruošimas, metodinė veikla) strictly outside lesson hours (e.g. after lessons, e.g. 13:40-16:00). Set workCategory to 'flexible'.
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
    console.error("Gemini generation failed:", error);
    return generateSimpleSchedule(roles, totalWeeklyMinutes, startTime, lunchDuration, lunchStartTime, lunchEndTime, hasLunch, isTeacher);
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
    isTeacher: boolean = false
): DaySchedule[] => {
  const dailyMinutesTarget = totalWeeklyMinutes / 5;
  const days = ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis"];
  const startMin = timeToMinutes(startTime);
  const targetLunchStartMin = timeToMinutes(lunchStartTime);
  let targetLunchEndMin = timeToMinutes(lunchEndTime);
  if (targetLunchEndMin <= targetLunchStartMin) {
    targetLunchEndMin = targetLunchStartMin + (lunchDuration || 30);
  }
  const effectiveLunchDuration = targetLunchEndMin - targetLunchStartMin;

  // For teachers: first assign contact lessons, then flexible non-contact hours outside lessons
  if (isTeacher) {
    // Total contact minutes vs flexible minutes
    // Usually a teacher has 15-25 lesson hours/week (approx 3-5 lessons per day)
    const lessonsPerDay = Math.min(6, Math.max(3, Math.round((dailyMinutesTarget * 0.6) / 45)));

    return days.map((day, dayIndex) => {
      const slots: DaySlot[] = [];
      let dayWorkMinutes = 0;
      const primaryRoleId = roles[0]?.id || '1';

      // 1. First add lessons (Kontaktinės valandos)
      for (let l = 0; l < lessonsPerDay && l < STANDARD_LESSON_BELLS.length; l++) {
        const bell = STANDARD_LESSON_BELLS[l];
        // If lunch falls around 4-5th lesson
        if (hasLunch && lunchDuration > 0 && l === 4) {
          slots.push({
            id: `slot-${dayIndex}-br`,
            startTime: lunchStartTime,
            endTime: lunchEndTime,
            type: 'break',
            roleId: '',
            isRemote: false
          });
        }

        slots.push({
          id: `slot-${dayIndex}-lesson-${l + 1}`,
          startTime: bell.startTime,
          endTime: bell.endTime,
          type: 'work',
          roleId: primaryRoleId,
          isRemote: false,
          workCategory: 'lesson',
          lessonNumber: l + 1
        });
        dayWorkMinutes += 45;
      }

      // 2. Add remaining flexible non-contact hours (pasiruošimas, metodinė veikla) strictly OUTSIDE lesson times
      const remainingFlexible = Math.max(0, dailyMinutesTarget - dayWorkMinutes);
      if (remainingFlexible > 0) {
        // Last lesson end time
        const lastLesson = slots.filter(s => s.type === 'work')[slots.filter(s => s.type === 'work').length - 1];
        let flexStart = lastLesson ? lastLesson.endTime : "14:00";
        // Start 10 min after last lesson or immediately
        const flexStartMin = timeToMinutes(flexStart) + 10;
        const flexEndMin = flexStartMin + remainingFlexible;

        slots.push({
          id: `slot-${dayIndex}-flex`,
          startTime: minutesToTime(flexStartMin),
          endTime: minutesToTime(flexEndMin),
          type: 'work',
          roleId: roles.length > 1 ? roles[1].id : primaryRoleId,
          isRemote: false,
          workCategory: 'flexible'
        });
      }

      return {
        id: `day-${dayIndex}`,
        dayName: day,
        dateOffset: dayIndex,
        slots: sortSlots(slots)
      };
    });
  }

  // Standard non-teacher schedule generator
  let roleQueue = roles.map(r => ({
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
