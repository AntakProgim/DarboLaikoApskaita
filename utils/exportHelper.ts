import { DaySchedule, WorkConfig } from '../types';
import { calculateSlotMinutes, calculateDayRemoteMinutes, calculateDayNetMinutes, getDayWorkDetails, getSlotAccountedMinutes } from './timeHelper';

export const exportToTXT = (schedule: DaySchedule[], config: WorkConfig) => {
  const totalInternalMinutes = schedule.reduce((acc, day) => acc + calculateDayNetMinutes(day.slots.filter(s => s.type === 'work')), 0);
  const totalExternalMinutes = schedule.reduce((acc, day) => {
    return acc + day.slots.reduce((dTotal, s) => {
      if (s.type === 'external' || s.isExternal) {
        return dTotal + calculateSlotMinutes(s.startTime, s.endTime);
      }
      return dTotal;
    }, 0);
  }, 0);
  
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

  // Calculate Actual Minutes Per Role (using getSlotAccountedMinutes: 1 lesson = 60 min.)
  const actualRoleMinutes: Record<string, number> = {};
  schedule.forEach(day => {
      day.slots.forEach(slot => {
          if (slot.type === 'work' && slot.roleId) {
              const dur = getSlotAccountedMinutes(slot);
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
  content += `Darbuotojas: ${config.fullName || 'Nenurodyta'}\n`;
  if (config.isTeacher) {
    content += `Darbo specifika: Pedagoginis darbas (Mokytojas)\n`;
    content += `Pedagoginio darbo dienos norma: maks. 10 val. 18 min. (pietų laikas neįskaičiuojamas)\n`;
  }
  content += `Maksimali bendra darbo dienos trukmė: 12 val. (pietų laikas neįskaičiuojamas)\n`;
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
  content += `Pagrindinė darbovietė (faktas): ${formatHM(totalInternalMinutes)} (Tikslas: ${formatHM(mainTargetMinutes)})\n`;
  if (totalExternalMinutes > 0) {
    content += `Kitos darbovietės (faktas): ${formatHM(totalExternalMinutes)}\n`;
    content += `Bendra visų darboviečių trukmė: ${formatHM(totalInternalMinutes + totalExternalMinutes)}\n`;
  }
  content += `Faktinis nuotolinis laikas: ${formatHM(totalRemoteScheduledMinutes)}\n`;
  if (totalBreakMinutes > 0) {
      content += `Pietų pertraukos (viso, neįskaitoma į darbo laiką): ${formatHM(totalBreakMinutes)}\n`;
  }
  content += `========================================\n\n`;

  schedule.forEach(day => {
    const details = getDayWorkDetails(day.slots, config.roles);
    content += `----------------------------------------\n`;
    content += `${day.dayName.toUpperCase()}\n`;
    content += `  Darbo laikas pagrindinėje: ${formatHM(details.internalTotal)}\n`;
    if (details.externalMinutes > 0) {
      content += `  Darbo laikas kitose darbovietėse: ${formatHM(details.externalMinutes)}\n`;
      content += `  Bendra dienos darbo trukmė: ${formatHM(details.grandTotal)}\n`;
    }
    content += `----------------------------------------\n`;
    
    const dailyStats: Record<string, number> = {};
    
    if (day.slots.length === 0) {
      content += `  Nėra suplanuoto laiko\n`;
    } else {
      day.slots.forEach(slot => {
          const dur = calculateSlotMinutes(slot.startTime, slot.endTime);
          if (slot.type === 'break') {
              content += `  ${slot.startTime} - ${slot.endTime} | PIETŲ PERTRAUKA (${dur} min) [neįskaitoma į darbo laiką]\n`;
          } else if (slot.type === 'external' || slot.isExternal) {
              const place = slot.workplaceName || 'Kita darbovietė';
              content += `  ${slot.startTime} - ${slot.endTime} | KITA DARBOVIETĖ: ${place} | ${formatHM(dur)}\n`;
          } else {
              const role = config.roles.find(r => r.id === slot.roleId);
              const roleTitle = role ? role.title : 'Nenurodyta';
              const loc = slot.isRemote ? 'NUOTOLINIU' : 'KONTAKTINIU / MOKYKLOJE';
              const cat = slot.workCategory === 'lesson' 
                ? `[PAMOKA #${slot.lessonNumber || ''}]` 
                : slot.workCategory === 'flexible' 
                  ? '[LANKSČIOS / NEKONTAKTINĖS]' 
                  : '';
              content += `  ${slot.startTime} - ${slot.endTime} | ${roleTitle} ${cat} (${loc}) | ${formatHM(dur)}\n`;
              
              dailyStats[slot.roleId] = (dailyStats[slot.roleId] || 0) + dur;
          }
      });
    }

    // Daily breakdown summary
    const workedRoles = Object.keys(dailyStats);
    if (workedRoles.length > 0) {
        content += `\n  Dienos pareigų suvestinė:\n`;
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
