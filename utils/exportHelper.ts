import { DaySchedule, WorkConfig } from '../types';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  calculateSlotMinutes, 
  calculateDayRemoteMinutes, 
  calculateDayNetMinutes, 
  getDayWorkDetails, 
  getSlotAccountedMinutes, 
  getSlotRole, 
  isSlotLessonTime 
} from './timeHelper';

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

  // Calculate Actual Minutes Per Role (using getSlotAccountedMinutes: 1 lesson = 60 min. of teacher work)
  const actualRoleMinutes: Record<string, number> = {};
  schedule.forEach(day => {
      day.slots.forEach(slot => {
          if (slot.type === 'work') {
              const assignedRole = getSlotRole(slot, config.roles);
              const rId = assignedRole ? assignedRole.id : slot.roleId;
              if (rId) {
                const dur = getSlotAccountedMinutes(slot);
                actualRoleMinutes[rId] = (actualRoleMinutes[rId] || 0) + dur;
              }
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
    const remoteTag = day.isRemote ? ' [DARBAS IŠ NAMŲ / NUOTOLINIS]' : '';
    content += `${day.dayName.toUpperCase()}${remoteTag}\n`;
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
              const assignedRole = getSlotRole(slot, config.roles);
              const roleTitle = assignedRole ? assignedRole.title : 'Nenurodyta';
              const roleId = assignedRole ? assignedRole.id : slot.roleId;
              const isLesson = slot.workCategory === 'lesson' || isSlotLessonTime(slot);
              const loc = slot.isRemote ? 'NUOTOLINIU' : 'KONTAKTINIU / MOKYKLOJE';
              const cat = isLesson 
                ? `[PAMOKA #${slot.lessonNumber || ''}]` 
                : slot.workCategory === 'flexible' 
                  ? '[LANKSČIOS / NEKONTAKTINĖS]' 
                  : '';
              const accountedMin = getSlotAccountedMinutes(slot);
              const timeNote = isLesson ? `1 val. mokytojo darbo (pamoka 45 min.)` : formatHM(dur);
              content += `  ${slot.startTime} - ${slot.endTime} | ${roleTitle} ${cat} (${loc}) | ${timeNote}\n`;
              
              if (roleId) {
                dailyStats[roleId] = (dailyStats[roleId] || 0) + accountedMin;
              }
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

/**
 * Exports the schedule as a professionally formatted official PDF document
 * with a structured summary of total hours per role, weekly timetable,
 * legal compliance metrics, and signature lines.
 */
export const exportToPDF = async (schedule: DaySchedule[], config: WorkConfig): Promise<void> => {
  // Calculate stats
  const totalInternalMinutes = schedule.reduce((acc, day) => acc + calculateDayNetMinutes(day.slots.filter(s => s.type === 'work')), 0);
  const totalExternalMinutes = schedule.reduce((acc, day) => {
    return acc + day.slots.reduce((dTotal, s) => {
      if (s.type === 'external' || s.isExternal) {
        return dTotal + calculateSlotMinutes(s.startTime, s.endTime);
      }
      return dTotal;
    }, 0);
  }, 0);

  const mainTargetMinutes = config.roles.reduce((sum, role) => sum + (role.hours * 60) + role.minutes, 0);
  const totalRemoteScheduledMinutes = schedule.reduce((sum, day) => sum + calculateDayRemoteMinutes(day.slots), 0);

  const actualRoleMinutes: Record<string, number> = {};
  schedule.forEach(day => {
    day.slots.forEach(slot => {
      if (slot.type === 'work') {
        const assignedRole = getSlotRole(slot, config.roles);
        const rId = assignedRole ? assignedRole.id : slot.roleId;
        if (rId) {
          const dur = getSlotAccountedMinutes(slot);
          actualRoleMinutes[rId] = (actualRoleMinutes[rId] || 0) + dur;
        }
      }
    });
  });

  const formatHM = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m} min.`;
    if (m === 0) return `${h} val.`;
    return `${h} val. ${m} min.`;
  };

  // Build temporary DOM container for PDF rendering
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px'; // Standard A4 width in px at 96 DPI
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#1e293b';
  container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  container.style.padding = '36px 40px';
  container.style.boxSizing = 'border-box';
  container.style.lineHeight = '1.4';

  const todayStr = new Date().toLocaleDateString('lt-LT');
  const employeeName = config.fullName || 'Nenurodyta';

  // Render HTML structure
  container.innerHTML = `
    <div style="border-bottom: 2px solid #2563eb; padding-bottom: 14px; margin-bottom: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px;">
            Darbo Laiko Grafikas
          </h1>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px;">
            Oficialus pedagoginio ir darbo laiko apskaitos dokumentas
          </div>
        </div>
        <div style="text-align: right; font-size: 10px; color: #475569; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; background-color: #f8fafc;">
          <div><b>SUDARYTA:</b> ${todayStr}</div>
          <div><b>FORMA:</b> Savaitinis grafikas</div>
        </div>
      </div>
    </div>

    <!-- Employee & Metadata Block -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px;">
      <div>
        <div style="color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 600;">Darbuotojas:</div>
        <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 1px;">${employeeName}</div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 600;">Statusas / Specifika:</div>
        <div style="font-weight: 600; color: #2563eb; margin-top: 1px;">
          ${config.isTeacher ? 'Pedagoginis darbuotojas (Mokytojas)' : 'Standartinis darbuotojas'}
        </div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 600;">Pagrindinė darbovietė:</div>
        <div style="font-weight: 700; color: #0f172a; margin-top: 1px;">
          Suplanuota ${formatHM(totalInternalMinutes)} (Norma: ${formatHM(mainTargetMinutes)})
        </div>
      </div>
      <div>
        <div style="color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 600;">Darbas iš namų / Nuotolis:</div>
        <div style="font-weight: 600; color: #059669; margin-top: 1px;">
          ${totalRemoteScheduledMinutes > 0 ? formatHM(totalRemoteScheduledMinutes) : 'Nenumatytas'}
        </div>
      </div>
    </div>

    <!-- ROLE SUMMARY TABLE -->
    <div style="margin-bottom: 20px;">
      <h2 style="font-size: 12px; font-weight: 700; color: #334155; text-transform: uppercase; margin: 0 0 8px 0; letter-spacing: 0.5px; border-left: 3px solid #2563eb; padding-left: 8px;">
        1. Suplanuotų valandų suvestinė pagal pareigas
      </h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden;">
        <thead>
          <tr style="background-color: #f1f5f9; color: #334155; text-align: left; font-weight: 700; border-bottom: 1px solid #cbd5e1;">
            <th style="padding: 7px 10px; border-right: 1px solid #cbd5e1;">Pareigų pavadinimas</th>
            <th style="padding: 7px 10px; border-right: 1px solid #cbd5e1; text-align: center; width: 110px;">Savaitės norma</th>
            <th style="padding: 7px 10px; border-right: 1px solid #cbd5e1; text-align: center; width: 110px;">Suplanuota</th>
            <th style="padding: 7px 10px; text-align: center; width: 100px;">Balansas</th>
          </tr>
        </thead>
        <tbody>
          ${config.roles.map((role, idx) => {
            const targetMin = role.hours * 60 + role.minutes;
            const actualMin = actualRoleMinutes[role.id] || 0;
            const diff = actualMin - targetMin;
            const isMatch = diff === 0;
            const diffStr = isMatch ? '✓ Atitinka' : `${diff > 0 ? '+' : ''}${formatHM(diff)}`;
            const diffColor = isMatch ? '#15803d' : diff > 0 ? '#b45309' : '#dc2626';
            const bgRow = idx % 2 === 0 ? '#ffffff' : '#f8fafc';

            return `
              <tr style="background-color: ${bgRow}; border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 7px 10px; font-weight: 600; color: #1e293b; border-right: 1px solid #cbd5e1;">
                  ${role.title || `Pareigos #${idx + 1}`}
                  ${idx === 0 ? '<span style="font-size: 9px; background-color: #dbeafe; color: #1e40af; padding: 1px 5px; border-radius: 4px; margin-left: 6px;">Pagrindinės</span>' : ''}
                </td>
                <td style="padding: 7px 10px; text-align: center; font-family: monospace; border-right: 1px solid #cbd5e1;">
                  ${formatHM(targetMin)}
                </td>
                <td style="padding: 7px 10px; text-align: center; font-family: monospace; font-weight: 700; color: #1e3a8a; border-right: 1px solid #cbd5e1;">
                  ${formatHM(actualMin)}
                </td>
                <td style="padding: 7px 10px; text-align: center; font-weight: 700; color: ${diffColor};">
                  ${diffStr}
                </td>
              </tr>
            `;
          }).join('')}
          <tr style="background-color: #e2e8f0; font-weight: 800; border-top: 2px solid #cbd5e1;">
            <td style="padding: 7px 10px; border-right: 1px solid #cbd5e1;">BENDRA PAGRINDINĖJE DARBOVIETĖJE:</td>
            <td style="padding: 7px 10px; text-align: center; font-family: monospace; border-right: 1px solid #cbd5e1;">${formatHM(mainTargetMinutes)}</td>
            <td style="padding: 7px 10px; text-align: center; font-family: monospace; border-right: 1px solid #cbd5e1; color: #1e3a8a;">${formatHM(totalInternalMinutes)}</td>
            <td style="padding: 7px 10px; text-align: center; color: ${totalInternalMinutes === mainTargetMinutes ? '#15803d' : '#b45309'};">
              ${totalInternalMinutes === mainTargetMinutes ? '✓ 100%' : formatHM(totalInternalMinutes - mainTargetMinutes)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- DAILY TIMETABLE SECTION -->
    <div style="margin-bottom: 22px;">
      <h2 style="font-size: 12px; font-weight: 700; color: #334155; text-transform: uppercase; margin: 0 0 8px 0; letter-spacing: 0.5px; border-left: 3px solid #2563eb; padding-left: 8px;">
        2. Savaitės dienų detalus grafikas (I–V)
      </h2>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${schedule.map((day) => {
          const details = getDayWorkDetails(day.slots, config.roles);
          const hasSlots = day.slots.length > 0;

          return `
            <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; background-color: #ffffff;">
              <div style="background-color: #f1f5f9; padding: 6px 10px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #cbd5e1; font-size: 11px;">
                <div>
                  <span style="font-weight: 700; color: #1e293b;">${day.dayName.toUpperCase()}</span>
                  ${day.isRemote ? '<span style="font-size: 9px; background-color: #d1fae5; color: #065f46; padding: 1px 5px; border-radius: 4px; margin-left: 6px; font-weight: 700;">NUOTOLINIS</span>' : ''}
                </div>
                <div style="font-size: 10px; font-weight: 600; color: #475569;">
                  Dienos darbo laikas: <b style="color: #0f172a; font-family: monospace;">${formatHM(details.internalTotal)}</b>
                  ${details.breakMinutes > 0 ? `(Pietūs: ${details.breakMinutes} min.)` : ''}
                </div>
              </div>

              ${!hasSlots ? `
                <div style="padding: 8px 10px; font-size: 10px; color: #94a3b8; font-style: italic;">
                  Nėra suplanuotų veiklų (poilsio diena)
                </div>
              ` : `
                <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
                  <tbody>
                    ${day.slots.map((slot, sIdx) => {
                      const dur = calculateSlotMinutes(slot.startTime, slot.endTime);
                      const isBreak = slot.type === 'break';
                      const isExternal = slot.type === 'external' || slot.isExternal;
                      const isLesson = slot.workCategory === 'lesson' || isSlotLessonTime(slot);
                      const isFlex = slot.workCategory === 'flexible';
                      const assigned = getSlotRole(slot, config.roles);
                      const roleName = assigned ? assigned.title : 'Pagrindinės';

                      let badgeText = '';
                      let badgeBg = '#f1f5f9';
                      let badgeColor = '#475569';

                      if (isBreak) {
                        badgeText = 'PIETŲ PERTRAUKA (Neįskaitoma)';
                        badgeBg = '#ffedd5';
                        badgeColor = '#9a3412';
                      } else if (isExternal) {
                        badgeText = `KITA DARBOVIETĖ: ${slot.workplaceName || 'Kita'}`;
                        badgeBg = '#ccfbf1';
                        badgeColor = '#115e59';
                      } else if (isLesson) {
                        badgeText = `PAMOKA #${slot.lessonNumber || ''} (1 val. apskaitoje)`;
                        badgeBg = '#e0f2fe';
                        badgeColor = '#0369a1';
                      } else if (isFlex) {
                        badgeText = 'LANKSČIOS / NEKONTAKTINĖS VALANDOS';
                        badgeBg = '#f3e8ff';
                        badgeColor = '#6b21a8';
                      } else {
                        badgeText = 'BENDROS DARBO VALANDOS';
                        badgeBg = '#eff6ff';
                        badgeColor = '#1d4ed8';
                      }

                      return `
                        <tr style="border-bottom: 1px solid #f1f5f9; ${isBreak ? 'background-color: #fffbeb;' : ''}">
                          <td style="padding: 5px 10px; width: 110px; font-family: monospace; font-weight: 700; color: #0f172a;">
                            ${slot.startTime} – ${slot.endTime}
                          </td>
                          <td style="padding: 5px 10px; font-weight: 600; color: #334155;">
                            ${isBreak ? 'Pietų pertrauka' : isExternal ? slot.workplaceName : roleName}
                            <span style="font-size: 9px; padding: 1px 5px; border-radius: 4px; margin-left: 6px; font-weight: 700; background-color: ${badgeBg}; color: ${badgeColor};">
                              ${badgeText}
                            </span>
                          </td>
                          <td style="padding: 5px 10px; text-align: right; width: 90px; font-family: monospace; font-weight: 600; color: #475569;">
                            ${isBreak ? `${dur} min.` : formatHM(getSlotAccountedMinutes(slot))}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              `}
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- SIGNATURE AND APPROVAL BLOCK -->
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #cbd5e1; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; font-size: 11px;">
      <div>
        <div style="font-weight: 700; color: #334155; margin-bottom: 24px;">SU GRAFIKU SUSIPAŽINAU:</div>
        <div style="border-bottom: 1px solid #94a3b8; width: 100%; margin-bottom: 4px;"></div>
        <div style="font-size: 10px; color: #64748b; display: flex; justify-content: space-between;">
          <span>(Darbuotojo parašas)</span>
          <span>${employeeName}</span>
        </div>
      </div>
      <div>
        <div style="font-weight: 700; color: #334155; margin-bottom: 24px;">TVIRTINU:</div>
        <div style="border-bottom: 1px solid #94a3b8; width: 100%; margin-bottom: 4px;"></div>
        <div style="font-size: 10px; color: #64748b; display: flex; justify-content: space-between;">
          <span>(Vadovo pareigos, parašas)</span>
          <span>(Data)</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210; // A4 width mm
    const pageHeight = 297; // A4 height mm
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2);
    const contentHeight = (canvas.height * contentWidth) / canvas.width;

    let heightLeft = contentHeight;
    let position = margin;

    // First page
    pdf.addImage(imgData, 'PNG', margin, position, contentWidth, contentHeight);
    heightLeft -= (pageHeight - margin * 2);

    // Multi-page handling if content overflows
    while (heightLeft > 0) {
      position = heightLeft - contentHeight + margin;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, position, contentWidth, contentHeight);
      heightLeft -= (pageHeight - margin * 2);
    }

    const safeName = (config.fullName || 'Darbo').replace(/\s+/g, '_');
    pdf.save(`${safeName}_Darbo_Grafikas.pdf`);
  } finally {
    document.body.removeChild(container);
  }
};
