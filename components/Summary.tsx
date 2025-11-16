
import React, { useMemo } from 'react';
import { DaySchedule, WorkConfig } from '../types';
import { calculateDayNetMinutes, calculateDayRemoteMinutes, calculateSlotMinutes } from '../utils/timeHelper';
import { exportToCSV } from '../utils/exportHelper';
import { Download, User, Briefcase, Clock, AlertCircle, CheckCircle, Pencil, Table, FileText } from 'lucide-react';

interface SummaryProps {
  schedule: DaySchedule[];
  config: WorkConfig;
  onConfigUpdate: (config: WorkConfig) => void;
}

export const Summary: React.FC<SummaryProps> = ({ schedule, config, onConfigUpdate }) => {
  const totalMinutes = schedule.reduce((acc, day) => acc + calculateDayNetMinutes(day.slots), 0);
  
  const totalBreakMinutes = schedule.reduce((total, day) => {
      return total + day.slots.reduce((dayTotal, slot) => {
          if (slot.type === 'break') {
              return dayTotal + calculateSlotMinutes(slot.startTime, slot.endTime);
          }
          return dayTotal;
      }, 0);
  }, 0);

  const mainTargetMinutes = config.roles.reduce((sum, role) => {
      return sum + (role.hours * 60) + role.minutes;
  }, 0);
  
  const diff = totalMinutes - mainTargetMinutes;
  
  const totalRemoteScheduledMinutes = schedule.reduce((sum, day) => sum + calculateDayRemoteMinutes(day.slots), 0);

  // Calculate Actual Minutes Per Role
  const actualRoleMinutes = useMemo(() => {
    const stats: Record<string, number> = {};
    schedule.forEach(day => {
        day.slots.forEach(slot => {
            if (slot.type === 'work' && slot.roleId) {
                const dur = calculateSlotMinutes(slot.startTime, slot.endTime);
                stats[slot.roleId] = (stats[slot.roleId] || 0) + dur;
            }
        });
    });
    return stats;
  }, [schedule]);
  
  const formatHM = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const hStr = h.toString().padStart(2, '0');
    const mStr = m.toString().padStart(2, '0');
    return `${hStr} val. ${mStr} min.`;
  };

  const formatHMSimple = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (h === 0) return `${m}m`;
      if (m === 0) return `${h}h`;
      return `${h}h ${m}m`;
  };

  const handleRoleTimeUpdate = (roleId: string, field: 'hours' | 'minutes', val: string) => {
      let num = parseInt(val, 10);
      if (isNaN(num) || num < 0) num = 0;
      if (field === 'minutes') num = Math.min(59, num);
      
      const updatedRoles = config.roles.map(r => {
          if (r.id === roleId) return { ...r, [field]: num };
          return r;
      });
      
      onConfigUpdate({ ...config, roles: updatedRoles });
  };

  const handleExport = () => {
    let content = `DARBO LAIKO GRAFIKAS\n`;
    content += `========================================\n`;
    content += `Darbuotojas: ${config.fullName}\n`;
    content += `----------------------------------------\n`;
    content += `PAREIGOS (Suplanuota / Tikslas):\n`;
    config.roles.forEach(role => {
        const targetMin = role.hours * 60 + role.minutes;
        const actualMin = actualRoleMinutes[role.id] || 0;
        content += `- ${role.title}: ${formatHM(actualMin)} / ${formatHM(targetMin)}\n`;
    });
    content += `----------------------------------------\n`;
    content += `BENDRA SAVAITĖS TRUKMĖ: ${formatHM(mainTargetMinutes)}\n`;
    content += `Faktinis nuotolinis grafike: ${formatHM(totalRemoteScheduledMinutes)}\n`;
    if (totalBreakMinutes > 0) {
        content += `Pietų pertraukos (viso): ${formatHM(totalBreakMinutes)}\n`;
    }
    content += `----------------------------------------\n`;
    content += `Suplanuota grafike (darbo laikas): ${formatHM(totalMinutes)}\n`;
    content += `========================================\n\n`;

    schedule.forEach(day => {
      const net = calculateDayNetMinutes(day.slots);
      content += `${day.dayName.toUpperCase()}\n`;
      content += `Dirbta: ${formatHM(net)}\n`;
      content += `Detaliai:\n`;
      
      day.slots.forEach(slot => {
          const dur = calculateSlotMinutes(slot.startTime, slot.endTime);
          if (slot.type === 'break') {
              content += `  [${slot.startTime} - ${slot.endTime}] PERTRAUKA (${dur} min)\n`;
          } else {
              const role = config.roles.find(r => r.id === slot.roleId);
              const roleTitle = role ? role.title : 'Darbas';
              const loc = slot.isRemote ? 'NUOTOLINIU' : 'BIURE';
              content += `  [${slot.startTime} - ${slot.endTime}] ${roleTitle} (${loc}) - ${formatHM(dur)}\n`;
          }
      });
      content += `\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.fullName.replace(/\s+/g, '_')}_Grafikas.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 mb-8">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start mb-6 gap-4 border-b border-gray-100 pb-4">
        <div className="space-y-1 w-full">
           <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <User className="text-blue-600" size={20}/>
            {config.fullName || "Nenurodyta"}
          </h2>
        </div>
        <div className="flex gap-2">
            <button
            onClick={handleExport}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-colors text-sm font-medium shrink-0"
            title="Atsisiųsti .txt"
            >
            <FileText size={16} />
            <span className="hidden sm:inline">TXT</span>
            </button>
            <button
            onClick={() => exportToCSV(schedule, config)}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium shrink-0"
            title="Atsisiųsti .csv"
            >
            <Table size={16} />
            <span className="hidden sm:inline">CSV</span>
            </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 flex flex-col gap-1">
             <div className="text-xs uppercase tracking-wide text-blue-600 font-semibold mb-1 flex items-center gap-1">
                <Clock size={14}/> Suplanuota
             </div>
             <div className="text-2xl font-bold text-blue-900">{formatHM(totalMinutes)}</div>
             
             <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-blue-200/50">
                {config.roles.map(role => {
                    const actual = actualRoleMinutes[role.id] || 0;
                    if (actual === 0) return null;
                    return (
                         <div key={role.id} className="flex justify-between items-center text-xs text-blue-800">
                            <span className="truncate max-w-[100px] opacity-80" title={role.title}>{role.title}</span>
                            <span className="font-mono font-medium">{formatHMSimple(actual)}</span>
                         </div>
                    );
                })}
             </div>
          </div>

          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex flex-col justify-between">
             <div>
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Tikslas</div>
                <div className="text-2xl font-bold text-gray-700">{formatHM(mainTargetMinutes)}</div>
             </div>
          </div>

          <div className={`p-4 rounded-xl border ${diff >= 0 ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'} flex flex-col justify-between`}>
             <div>
                <div className={`text-xs uppercase tracking-wide font-semibold mb-1 flex items-center gap-1 ${diff >= 0 ? 'text-green-600' : 'text-amber-600'}`}>
                    {diff >= 0 ? <CheckCircle size={14}/> : <AlertCircle size={14}/>} 
                    Balansas
                </div>
                <div className={`text-2xl font-bold ${diff >= 0 ? 'text-green-700' : 'text-amber-700'}`}>
                    {diff > 0 ? '+' : ''}{formatHM(diff)}
                </div>
             </div>
          </div>

          <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100 flex flex-col justify-between">
             <div>
                <div className="text-xs uppercase tracking-wide text-indigo-600 font-semibold mb-1 flex items-center gap-1">
                    Nuotolinis (Fakt.)
                </div>
                <div className="text-2xl font-bold text-indigo-800">{formatHM(totalRemoteScheduledMinutes)}</div>
             </div>
          </div>
      </div>

      {/* Role Breakdown Table */}
      <div className="bg-gray-50/50 rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-xs font-bold uppercase text-gray-500 flex justify-between items-center">
             <span>Pareigų suvestinė (Redaguoti tikslą)</span>
             <Pencil size={12} className="text-gray-400"/>
        </div>
        <div className="divide-y divide-gray-100">
            {config.roles.map(role => {
                const actual = actualRoleMinutes[role.id] || 0;
                const target = role.hours * 60 + role.minutes;
                const roleDiff = actual - target;
                
                return (
                    <div key={role.id} className="p-3 grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center hover:bg-white transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                            <Briefcase size={16} className="text-gray-400 shrink-0"/>
                            <span className="font-medium text-sm text-gray-800 truncate" title={role.title}>{role.title}</span>
                        </div>

                        {/* Editable Target */}
                        <div className="flex flex-col">
                            <span className="text-[10px] text-gray-400 font-bold uppercase mb-0.5 sm:hidden">Tikslas</span>
                            <div className="flex items-center gap-1">
                                <div className="relative w-10">
                                    <input 
                                        type="number" 
                                        className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-xs text-center focus:ring-1 focus:ring-blue-500 outline-none"
                                        value={role.hours}
                                        onChange={(e) => handleRoleTimeUpdate(role.id, 'hours', e.target.value)}
                                    />
                                    <span className="absolute -top-2 right-0 text-[8px] text-gray-400 bg-white px-0.5">h</span>
                                </div>
                                <span className="text-gray-300">:</span>
                                <div className="relative w-10">
                                    <input 
                                        type="number" 
                                        className="w-full bg-white border border-gray-300 rounded px-1 py-0.5 text-xs text-center focus:ring-1 focus:ring-blue-500 outline-none"
                                        value={role.minutes}
                                        onChange={(e) => handleRoleTimeUpdate(role.id, 'minutes', e.target.value)}
                                    />
                                    <span className="absolute -top-2 right-0 text-[8px] text-gray-400 bg-white px-0.5">m</span>
                                </div>
                            </div>
                        </div>

                        {/* Actual */}
                        <div className="flex flex-col">
                             <span className="text-[10px] text-gray-400 font-bold uppercase mb-0.5 sm:hidden">Suplanuota</span>
                             <span className="text-sm font-mono font-medium text-gray-700">{formatHMSimple(actual)}</span>
                        </div>

                        {/* Diff */}
                        <div className="flex flex-col">
                             <span className="text-[10px] text-gray-400 font-bold uppercase mb-0.5 sm:hidden">Skirtumas</span>
                             <span className={`text-sm font-mono font-bold ${roleDiff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {roleDiff > 0 ? '+' : ''}{formatHMSimple(roleDiff)}
                             </span>
                        </div>
                    </div>
                );
            })}
        </div>
      </div>
    </div>
  );
};
