
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
    .map(r => `${r.title} (ID: ${r.id})`)
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
      3. If the total work duration in a day > 4 hours and lunchDuration > 0, insert a 'break' slot of exactly ${lunchDuration} minutes in the middle.
      4. Distribute the roles reasonably.
      5. Do NOT count break time towards the total working hours.
      6. By default, work slots are NOT remote (isRemote: false).
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
        // Try to find matching role ID by name, or default to first role
        const matchedRole = roles.find(r => r.title.toLowerCase() === (s.roleName || "").toLowerCase()) || roles[0];
        
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
  const dailyMinutes = totalWeeklyMinutes / 5;
  const days = ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis"];
  const defaultRole = roles[0];
  const startMin = timeToMinutes(startTime);

  return days.map((day, index) => {
    
    // Simple logic: Work -> Break -> Work
    // First chunk: 4 hours (240 min) or less
    
    const slots: DaySlot[] = [];
    let currentMin = startMin;
    
    // Chunk 1
    const chunk1Min = Math.min(240, dailyMinutes); 
    slots.push({
      id: `slot-${index}-1`,
      startTime: minutesToTime(currentMin),
      endTime: minutesToTime(currentMin + chunk1Min),
      type: 'work',
      roleId: defaultRole.id,
      isRemote: false
    });
    currentMin += chunk1Min;
    
    // Break (only if configured and day is long enough to warrant one)
    if (dailyMinutes > 240 && lunchDuration > 0) {
       slots.push({
        id: `slot-${index}-br`,
        startTime: minutesToTime(currentMin),
        endTime: minutesToTime(currentMin + lunchDuration),
        type: 'break',
        roleId: '',
        isRemote: false
      });
      currentMin += lunchDuration;
      
      // Chunk 2
      const remaining = dailyMinutes - chunk1Min;
      if (remaining > 0) {
        slots.push({
          id: `slot-${index}-2`,
          startTime: minutesToTime(currentMin),
          endTime: minutesToTime(currentMin + remaining),
          type: 'work',
          roleId: defaultRole.id,
          isRemote: false
        });
      }
    }

    return {
      id: `day-${index}`,
      dayName: day,
      dateOffset: index,
      slots
    };
  });
};