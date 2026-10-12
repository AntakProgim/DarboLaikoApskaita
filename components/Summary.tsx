import React, { useMemo } from 'react';
import { DaySchedule, WorkConfig } from '../types';
import { calculateDayNetMinutes, calculateDayRemoteMinutes, calculateSlotMinutes, getSlotAccountedMinutes } from '../utils/timeHelper';
import { exportToTXT } from '../utils/exportHelper';
import { Download, User, Briefcase, Clock, AlertCircle, CheckCircle, Pencil, Building2, BookOpen, Sparkles, Coffee, Info } from 'lucide-react';

interface SummaryProps {
  schedule: DaySchedule[];
  config: WorkConfig;
  onConfigUpdate: (config: WorkConfig) => void;
}

export const Summary: React.FC<SummaryProps> = ({ schedule, config, onConfigUpdate }) => {
  // Internal worked minutes (excluding breaks). 1 pamoka = 60 min. darbo laiko apskaitoje
  const totalInternalMinutes = schedule.reduce((acc, day) => {
    return acc + day.slots.reduce((dTotal, s) => {
      if (s.type === 'work') return dTotal + getSlotAccountedMinutes(s);
      return dTotal;
    }, 0);
  }, 0);

  // External workplaces worked minutes
  const totalExternalMinutes = schedule.reduce((acc, day) => {
    return acc + day.slots.reduce((dTotal, s) => {
      if (s.type === 'external' || s.isExternal) return dTotal + calculateSlotMinutes(s.startTime, s.endTime);
      return dTotal;
    }, 0);
  }, 0);

  // Total lunch breaks (excluded from working hours by law)
  const totalBreakMinutes = schedule.reduce((total, day) => {
    return total + day.slots.reduce((dayTotal, slot) => {
      if (slot.type === 'break') {
        return dayTotal + calculateSlotMinutes(slot.startTime, slot.endTime);
      }
      return dayTotal;
    }, 0);
  }, 0);

  // Lessons count & accounted minutes: Mokytojui pamokos laikas skaičiuojamas valandomis (1 pamoka = 1 val.)
  const totalLessonCount = schedule.reduce((total, day) => {
    return total + day.slots.filter(s => s.type === 'work' && s.workCategory === 'lesson').length;
  }, 0);
  const totalLessonAccountedMinutes = totalLessonCount * 60;

  const totalFlexibleMinutes = schedule.reduce((total, day) => {
    return total + day.slots.reduce((dTotal, s) => {
      if (s.type === 'work' && s.workCategory === 'flexible') return dTotal + calculateSlotMinutes(s.startTime, s.endTime);
      return dTotal;
    }, 0);
  }, 0);

  const mainTargetMinutes = config.roles.reduce((sum, role) => {
    return sum + (role.hours * 60) + role.minutes;
  }, 0);
  
  const diff = totalInternalMinutes - mainTargetMinutes;
  const totalRemoteScheduledMinutes = schedule.reduce((sum, day) => sum + calculateDayRemoteMinutes(day.slots), 0);

  // Calculate Actual Minutes Per Role (using getSlotAccountedMinutes so lessons count as 60m)
  const actualRoleMinutes = useMemo(() => {
    const stats: Record<string, number> = {};
    schedule.forEach(day => {
      day.slots.forEach(slot => {
        if (slot.type === 'work' && slot.roleId) {
          const dur = getSlotAccountedMinutes(slot);
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

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 mb-8">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start mb-6 gap-4 border-b border-gray-100 pb-4">
        <div className="space-y-1 w-full">
          <div className="flex items-center gap-2">
            <User className="text-blue-600" size={20}/>
            <h2 className="text-xl font-bold text-gray-800">
              {config.fullName || "Nenurodyta"}
            </h2>
            {config.isTeacher && (
              <span className="text-xs bg-sky-100 text-sky-800 font-bold px-2.5 py-0.5 rounded-full border border-sky-200">
                Pedagogas / Mokytojas
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">
            Dienos normos: maks. 10 val. 18 min. pedagoginio darbo | maks. 12 val. bendro darbo | pietų laikas neišsiskaičiuoja
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportToTXT(schedule, config)}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium shrink-0"
            title="Atsisiųsti .txt grafiko kopiją"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Atsisiųsti TXT</span>
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wide text-blue-600 font-semibold mb-1 flex items-center gap-1">
            <Clock size={14}/> Pagrindinė darbovietė
          </div>
          <div className="text-2xl font-bold text-blue-900">{formatHM(totalInternalMinutes)}</div>
          
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
            <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Tikslas (pagrindinis)</div>
            <div className="text-2xl font-bold text-gray-700">{formatHM(mainTargetMinutes)}</div>
          </div>
          {totalExternalMinutes > 0 && (
            <div className="text-xs font-semibold text-teal-700 pt-2 border-t border-gray-200 flex items-center justify-between">
              <span>Kita darbovietė:</span>
              <span className="font-mono">{formatHMSimple(totalExternalMinutes)}</span>
            </div>
          )}
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
          {config.isTeacher && (
            <div className="text-[11px] text-gray-600 pt-2 border-t border-gray-200/50 flex flex-col gap-0.5">
              <div className="flex justify-between">
                <span>Pamokos ({totalLessonCount} pam.):</span>
                <b title="1 pamoka = 1 val. darbo laiko normos, nors trunka 45 min.">{formatHMSimple(totalLessonAccountedMinutes)}</b>
              </div>
              <div className="flex justify-between">
                <span>Lanksčios val.:</span>
                <b>{formatHMSimple(totalFlexibleMinutes)}</b>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100 flex flex-col justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-indigo-600 font-semibold mb-1 flex items-center gap-1">
              Nuotolinis (Fakt.)
            </div>
            <div className="text-2xl font-bold text-indigo-800">{formatHM(totalRemoteScheduledMinutes)}</div>
          </div>
          {totalBreakMinutes > 0 && (
            <div className="text-[11px] text-orange-700 pt-2 border-t border-indigo-200/50 flex items-center justify-between">
              <span className="flex items-center gap-1"><Coffee size={11} /> Pietūs (viso):</span>
              <span className="font-mono font-bold">{formatHMSimple(totalBreakMinutes)}</span>
            </div>
          )}
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
