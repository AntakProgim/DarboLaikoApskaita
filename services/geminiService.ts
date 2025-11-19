
import { GoogleGenAI, Type } from "@google/genai";
import { DaySchedule, JobRole, DaySlot } from "../types";
import { timeToMinutes, minutesToTime, roundToNearest5 } from "../utils/timeHelper";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
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
  lunchDuration: number = 30
): Promise<DaySchedule[]> => {
  const ai = getAiClient();
  const targetHours = totalWeeklyMinutes / 60;

  const rolesDescription = roles
    .map(r => `${r.title} (ID: ${r.id}, Duration: ${r.hours}h ${r.minutes}m)`)
    .join(', ');
    
  if (!ai) {
    console.warn("API Key not found, using fallback.");
    return generateSimpleSchedule(roles, totalWeeklyMinutes, startTime, lunchDuration);
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Create a weekly work schedule (Monday to Friday) based on these roles: [${rolesDescription}].
      
      Total target working hours: ${targetHours.toFixed(2)}.
      
      Rules:
      1. Return a list of 5 days (Monday - Friday).
      2. Start the work day at ${startTime} (unless logic dictates otherwise).
      3. If the total work duration in a day > 4 hours and lunchDuration > 0, insert a 'break' slot of exactly ${lunchDuration} minutes in the middle (usually after 4 hours).
      4. Distribute the roles strictly according to their assigned duration.
      5. Do NOT count break time towards the total working hours.
      6. By default, work slots are NOT remote (isRemote: false).
      7. Use the exact 'roleId' provided in the description for each slot.
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
                    type: { type: Type.STRING, enum: ["work", "break"] },
                    roleId: { type: Type.STRING },
                    roleName: { type: Type.STRING },
                    isRemote: { type: Type.BOOLEAN }
                  },
                  required: ["startTime", "endTime", "type"]
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
    
    // Map raw response to our Typed structure
    return rawData.map((item: any, index: number) => {
      const slots: DaySlot[] = (item.slots || []).map((s: any, sIdx: number) => {
        // Prioritize ID match, then Name match, then Default
        let matchedRole = roles.find(r => r.id === s.roleId);
        if (!matchedRole && s.roleName) {
            matchedRole = roles.find(r => r.title.toLowerCase() === s.roleName.toLowerCase());
        }
        if (!matchedRole) matchedRole = roles[0];
        
        return {
          id: `slot-${index}-${sIdx}`,
          startTime: roundToNearest5(s.startTime), // Ensure time is clean
          endTime: roundToNearest5(s.endTime),     // Ensure time is clean
          type: s.type === 'break' ? 'break' : 'work',
          roleId: matchedRole ? matchedRole.id : "",
          isRemote: !!s.isRemote
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
    return generateSimpleSchedule(roles, totalWeeklyMinutes, startTime, lunchDuration);
  }
};

const generateSimpleSchedule = (
    roles: JobRole[], 
    totalWeeklyMinutes: number, 
    startTime: string,
    lunchDuration: number
): DaySchedule[] => {
  const dailyMinutesTarget = totalWeeklyMinutes / 5; // Average min per day
  const days = ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis"];
  const startMin = timeToMinutes(startTime);

  // Create a queue of minutes per role
  let roleQueue = roles.map(r => ({
      id: r.id,
      remaining: (r.hours * 60) + r.minutes
  }));

  return days.map((day, dayIndex) => {
    const slots: DaySlot[] = [];
    let currentClock = startMin;
    
    // We try to fill this day up to 'dailyMinutesTarget', but logic handles if roles run out
    let dayWorkMinutes = 0;
    let hasBreak = false;

    // While we haven't hit the day limit and there are roles left
    while (dayWorkMinutes < dailyMinutesTarget) {
        // Find first role with minutes remaining
        const activeRoleIndex = roleQueue.findIndex(r => r.remaining > 0);
        if (activeRoleIndex === -1) break; // All work done for the week

        const activeRole = roleQueue[activeRoleIndex];
        
        // Determine chunk size
        // Max chunk before break is usually 4 hours (240m)
        // Max remaining for day
        const remainingForDay = dailyMinutesTarget - dayWorkMinutes;
        
        // If we haven't had a break and we are reaching > 4 hours, limit this chunk
        let maxChunkSize = remainingForDay;
        
        if (!hasBreak && dayWorkMinutes < 240 && (dayWorkMinutes + maxChunkSize) > 240) {
             // Cap at the break point
             maxChunkSize = 240 - dayWorkMinutes;
        }

        // Also limit by how much the role has left
        const duration = Math.min(maxChunkSize, activeRole.remaining);
        
        // Create WORK slot
        if (duration > 0) {
            slots.push({
                id: `slot-${dayIndex}-${slots.length}`,
                startTime: minutesToTime(currentClock),
                endTime: minutesToTime(currentClock + duration),
                type: 'work',
                roleId: activeRole.id,
                isRemote: false
            });

            currentClock += duration;
            dayWorkMinutes += duration;
            activeRole.remaining -= duration;
        }

        // Insert BREAK if needed
        // If we just hit 240 minutes (4 hours) or exceeded it slightly, and haven't had break
        if (lunchDuration > 0 && !hasBreak && dayWorkMinutes >= 240 && dayWorkMinutes < dailyMinutesTarget) {
            slots.push({
                id: `slot-${dayIndex}-br`,
                startTime: minutesToTime(currentClock),
                endTime: minutesToTime(currentClock + lunchDuration),
                type: 'break',
                roleId: '',
                isRemote: false
            });
            currentClock += lunchDuration;
            hasBreak = true;
        }
    }

    return {
      id: `day-${dayIndex}`,
      dayName: day,
      dateOffset: dayIndex,
      slots
    };
  });
};
