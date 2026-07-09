
import { DaySchedule, WorkConfig } from '../types';
import { calculateSlotMinutes, calculateDayRemoteMinutes, calculateDayNetMinutes } from './timeHelper';

export const exportToTXT = (schedule: DaySchedule[], config: WorkConfig) => {
  const totalMinutes = schedule.reduce((acc, day) => acc + calculateDayNetMinutes(day.slots), 0);
  
  const totalBreakMinutes = schedule.reduce((total, day) => {
      return total + day.slots.reduce((dayTotal, slot) => {
          if (slot.type === 'break') {
              return dayTotal + calculateSlotMinutes(slot.startTime, slot.endTime);
          }
          return dayTotal;
      }, 0);
  }, 0);

  const mainTargetMinutes = config.roles.reduce((sum, role) => sum + (role.hours * 60) + role.minutes, 0);
  const totalRemoteScheduledMinutes = schedule.reduce((sum, day) => sum + calculateDayRemoteMinutes(day.slots), 0);

  // Calculate Actual Minutes Per Role
  const actualRoleMinutes: Record<string, number> = {};
  schedule.forEach(day => {
      day.slots.forEach(slot => {
          if (slot.type === 'work' && slot.roleId) {
              const dur = calculateSlotMinutes(slot.startTime, slot.endTime);
              actualRoleMinutes[slot.roleId] = (actualRoleMinutes[slot.roleId] || 0) + dur;
          }
      });
  });
  
  const formatHM = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const hStr = h.toString().padStart(2, '0');
    const mStr = m.toString().padStart(2, '0');
    return `${hStr} val. ${mStr} min.`;
  };

  let content = `DARBO LAIKO GRAFIKAS\n`;
  content += `========================================\n`;
  content += `Darbuotojas: ${config.fullName}\n`;
  content += `Sugeneruota: ${new Date().toLocaleDateString('lt-LT')}\n`;
  content += `----------------------------------------\n\n`;
  
  // Weekly Summary Breakdown
  content += `SAVAITĖS SUVESTINĖ:\n`;
  config.roles.forEach(role => {
      const targetMin = role.hours * 60 + role.minutes;
      const actualMin = actualRoleMinutes[role.id] || 0;
      content += `- ${role.title}: ${formatHM(actualMin)} (Tikslas: ${formatHM(targetMin)})\n`;
  });
  
  content += `\n`;
  content += `Bendra savaitės trukmė: ${formatHM(mainTargetMinutes)}\n`;
  content += `Faktinis darbo laikas: ${formatHM(totalMinutes)}\n`;
  content += `Faktinis nuotolinis laikas: ${formatHM(totalRemoteScheduledMinutes)}\n`;
  if (totalBreakMinutes > 0) {
      content += `Pietų pertraukos (viso): ${formatHM(totalBreakMinutes)}\n`;
  }
  content += `========================================\n\n`;

  schedule.forEach(day => {
    const net = calculateDayNetMinutes(day.slots);
    content += `----------------------------------------\n`;
    content += `${day.dayName.toUpperCase()} (${formatHM(net)})\n`;
    content += `----------------------------------------\n`;
    
    const dailyStats: Record<string, number> = {};
    
    if (day.slots.length === 0) {
      content += `  Nėra suplanuoto laiko\n`;
    } else {
      day.slots.forEach(slot => {
          const dur = calculateSlotMinutes(slot.startTime, slot.endTime);
          if (slot.type === 'break') {
              content += `  ${slot.startTime} - ${slot.endTime} | PERTRAUKA (${dur} min)\n`;
          } else {
              const role = config.roles.find(r => r.id === slot.roleId);
              const roleTitle = role ? role.title : 'Nenurodyta';
              const loc = slot.isRemote ? 'NUOTOLINIU' : 'BIURE';
              content += `  ${slot.startTime} - ${slot.endTime} | ${roleTitle} (${loc}) | ${formatHM(dur)}\n`;
              
              // Accumulate daily stats
              dailyStats[slot.roleId] = (dailyStats[slot.roleId] || 0) + dur;
          }
      });
    }

    // Daily breakdown summary
    const workedRoles = Object.keys(dailyStats);
    if (workedRoles.length > 0) {
        content += `\n  Dienos suvestinė:\n`;
        config.roles.forEach(role => {
            if (dailyStats[role.id]) {
                content += `  - ${role.title}: ${formatHM(dailyStats[role.id])}\n`;
            }
        });
    }

    content += `\n`;
  });

  const blob = new Blob(["\uFEFF" + content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const fileName = (config.fullName || 'Darbuotojas').replace(/\s+/g, '_');
  link.download = `${fileName}_Grafikas.txt`;
  link.click();
  URL.revokeObjectURL(url);
};
