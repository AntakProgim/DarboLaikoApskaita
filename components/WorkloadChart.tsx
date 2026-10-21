import React, { useState, useMemo } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  ReferenceLine,
  Cell
} from 'recharts';
import { DaySchedule, JobRole, ExternalWorkplace } from '../types';
import { 
  calculateSlotMinutes, 
  getSlotAccountedMinutes, 
  getSlotRole, 
  getSlotTeacherRole, 
  isSlotLessonTime,
  formatDuration 
} from '../utils/timeHelper';
import { BarChart3, Calendar, Briefcase, CheckCircle2, Layers } from 'lucide-react';

interface WorkloadChartProps {
  schedule: DaySchedule[];
  roles: JobRole[];
  shortFriday?: boolean;
}

const ROLE_COLORS = [
  '#3b82f6', // blue-500
  '#8b5cf6', // purple-500
  '#06b6d4', // cyan-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
];

const WEEKDAY_NAMES = ['Pirmadienis', 'Antradienis', 'Trečiadienis', 'Ketvirtadienis', 'Penktadienis'];
const WEEKDAY_SHORTS = ['Pr', 'An', 'Tr', 'Kt', 'Pn'];

export const WorkloadChart: React.FC<WorkloadChartProps> = ({
  schedule,
  roles,
  shortFriday = true
}) => {
  const [activeTab, setActiveTab] = useState<'byDay' | 'byRole'>('byDay');

  // Compute data for "By Day" stacked chart
  const dayData = useMemo(() => {
    return [0, 1, 2, 3, 4].map(dayIndex => {
      const day = schedule.find(d => d.dateOffset === dayIndex) || schedule[dayIndex];
      const entry: Record<string, any> = {
        name: WEEKDAY_SHORTS[dayIndex],
        fullName: WEEKDAY_NAMES[dayIndex],
        totalMinutes: 0
      };

      roles.forEach(role => {
        entry[role.id] = 0;
        entry[`${role.id}_minutes`] = 0;
      });

      if (day) {
        day.slots.forEach(slot => {
          if (slot.type === 'work') {
            const assignedRole = getSlotRole(slot, roles);
            const roleId = assignedRole ? assignedRole.id : slot.roleId;
            if (roleId) {
              const dur = getSlotAccountedMinutes(slot);
              entry[`${roleId}_minutes`] = (entry[`${roleId}_minutes`] || 0) + dur;
              entry.totalMinutes += dur;
            }
          }
        });
      }

      // Convert minutes to decimal hours for chart height
      roles.forEach(role => {
        const mins = entry[`${role.id}_minutes`] || 0;
        entry[role.id] = Number((mins / 60).toFixed(2));
      });

      entry.totalHours = Number((entry.totalMinutes / 60).toFixed(2));
      return entry;
    });
  }, [schedule, roles]);

  // Compute data for "By Role" target vs actual chart
  const roleData = useMemo(() => {
    return roles.map((role, idx) => {
      const targetMin = (role.hours * 60) + role.minutes;
      let actualMin = 0;

      schedule.forEach(day => {
        day.slots.forEach(slot => {
          if (slot.type === 'work') {
            const assigned = getSlotRole(slot, roles);
            if (assigned?.id === role.id) {
              actualMin += getSlotAccountedMinutes(slot);
            }
          }
        });
      });

      return {
        id: role.id,
        name: role.title || `Pareigos #${idx + 1}`,
        targetHours: Number((targetMin / 60).toFixed(2)),
        actualHours: Number((actualMin / 60).toFixed(2)),
        targetMinutes: targetMin,
        actualMinutes: actualMin,
        color: ROLE_COLORS[idx % ROLE_COLORS.length]
      };
    });
  }, [schedule, roles]);

  // Custom Tooltip for Day Stacked Chart
  const CustomDayTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-gray-900 text-white p-3 rounded-xl shadow-xl text-xs space-y-2 border border-gray-700 min-w-[180px]">
          <div className="font-bold border-b border-gray-700 pb-1 flex justify-between items-center text-sm">
            <span>{data.fullName}</span>
            <span className="text-blue-400 font-mono">{formatDuration(data.totalMinutes)}</span>
          </div>
          <div className="space-y-1">
            {roles.map((role, idx) => {
              const mins = data[`${role.id}_minutes`] || 0;
              if (mins === 0) return null;
              return (
                <div key={role.id} className="flex justify-between items-center gap-2">
                  <span className="flex items-center gap-1.5 opacity-90 truncate max-w-[120px]">
                    <span 
                      className="w-2.5 h-2.5 rounded-full shrink-0" 
                      style={{ backgroundColor: ROLE_COLORS[idx % ROLE_COLORS.length] }}
                    />
                    <span className="truncate">{role.title || `Pareigos #${idx + 1}`}</span>
                  </span>
                  <span className="font-mono font-semibold">{formatDuration(mins)}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  // Custom Tooltip for Role Comparison Chart
  const CustomRoleTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const diff = data.actualMinutes - data.targetMinutes;
      return (
        <div className="bg-gray-900 text-white p-3 rounded-xl shadow-xl text-xs space-y-1.5 border border-gray-700 min-w-[200px]">
          <div className="font-bold text-sm border-b border-gray-700 pb-1">{data.name}</div>
          <div className="flex justify-between items-center text-gray-300">
            <span>Savaitės tikslas:</span>
            <span className="font-mono font-semibold text-white">{formatDuration(data.targetMinutes)}</span>
          </div>
          <div className="flex justify-between items-center text-gray-300">
            <span>Suplanuota:</span>
            <span className="font-mono font-semibold text-blue-400">{formatDuration(data.actualMinutes)}</span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-gray-800 text-[11px]">
            <span>Balansas:</span>
            <span className={`font-mono font-bold ${diff === 0 ? 'text-green-400' : diff > 0 ? 'text-amber-400' : 'text-red-400'}`}>
              {diff === 0 ? '✓ Tiksliai atitinka' : `${diff > 0 ? '+' : ''}${formatDuration(diff)}`}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 mb-8 space-y-4">
      {/* Header & View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
            <BarChart3 size={18} />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-base">Suplanuotų valandų pasiskirstymas</h3>
            <p className="text-xs text-gray-500">Vizuali darbo laiko suvestinė stulpelinėje diagramoje</p>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex items-center bg-gray-100 p-1 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('byDay')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'byDay'
                ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Calendar size={13} />
            <span>Pagal dienas (I–V)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('byRole')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'byRole'
                ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Layers size={13} />
            <span>Tikslas vs Suplanuota</span>
          </button>
        </div>
      </div>

      {/* Chart Display */}
      <div className="h-64 sm:h-72 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          {activeTab === 'byDay' ? (
            <BarChart
              data={dayData}
              margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="name" 
                tick={{ fill: '#475569', fontSize: 12, fontWeight: 600 }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis 
                unit="h"
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomDayTooltip />} />
              <Legend 
                formatter={(value) => {
                  const r = roles.find(role => role.id === value);
                  return <span className="text-xs text-gray-700 font-medium">{r?.title || value}</span>;
                }}
                wrapperStyle={{ paddingTop: 10 }}
              />
              {/* Stacked bars for each role */}
              {roles.map((role, idx) => (
                <Bar 
                  key={role.id} 
                  dataKey={role.id} 
                  name={role.id}
                  stackId="a" 
                  fill={ROLE_COLORS[idx % ROLE_COLORS.length]} 
                  radius={idx === roles.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
              <ReferenceLine y={8} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '8h norma', fill: '#ef4444', fontSize: 10, position: 'right' }} />
            </BarChart>
          ) : (
            <BarChart
              data={roleData}
              margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="name" 
                tick={{ fill: '#475569', fontSize: 11, fontWeight: 600 }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
              />
              <YAxis 
                unit="h"
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomRoleTooltip />} />
              <Legend 
                formatter={(value) => (
                  <span className="text-xs text-gray-700 font-medium">
                    {value === 'targetHours' ? 'Savaitės norma (Tikslas)' : 'Suplanuotos valandos (Faktas)'}
                  </span>
                )}
                wrapperStyle={{ paddingTop: 10 }}
              />
              <Bar 
                dataKey="targetHours" 
                name="targetHours" 
                fill="#94a3b8" 
                radius={[6, 6, 0, 0]} 
              />
              <Bar 
                dataKey="actualHours" 
                name="actualHours" 
                fill="#4f46e5" 
                radius={[6, 6, 0, 0]} 
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Role Badges Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {roles.map((role, idx) => (
            <div key={role.id} className="flex items-center gap-1.5">
              <span 
                className="w-3 h-3 rounded-md shrink-0 shadow-2xs" 
                style={{ backgroundColor: ROLE_COLORS[idx % ROLE_COLORS.length] }} 
              />
              <span className="font-semibold text-gray-800">{role.title || `Pareigos #${idx + 1}`}:</span>
              <span className="text-gray-500 font-mono font-medium">
                {formatDuration((role.hours * 60) + role.minutes)}
              </span>
            </div>
          ))}
        </div>

        <div className="text-[11px] text-gray-500 flex items-center gap-1">
          <CheckCircle2 size={13} className="text-green-500 shrink-0" />
          <span>Diagrama atsinaujina realiuoju laiku redaguojant grafiką</span>
        </div>
      </div>
    </div>
  );
};
