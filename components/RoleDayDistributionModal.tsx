import React, { useState, useMemo } from 'react';
import { JobRole, WeekdayLessons, WorkConfig } from '../types';
import { 
  STANDARD_LESSON_BELLS, 
  formatDuration, 
  getSlotTeacherRole,
  calculateDailyTargets,
  minutesToTime,
  timeToMinutes
} from '../utils/timeHelper';
import { 
  Calendar, 
  Clock, 
  Sparkles, 
  Briefcase, 
  Check, 
  AlertCircle, 
  X, 
  GraduationCap, 
  BookOpen, 
  ChevronRight,
  Info
} from 'lucide-react';

interface RoleDayDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: WorkConfig;
  onConfirm: (updatedRoles: JobRole[]) => void;
}

const WEEKDAYS = [
  { offset: 0, short: 'Pr', full: 'Pirmadienis' },
  { offset: 1, short: 'An', full: 'Antradienis' },
  { offset: 2, short: 'Tr', full: 'Trečiadienis' },
  { offset: 3, short: 'Kt', full: 'Ketvirtadienis' },
  { offset: 4, short: 'Pn', full: 'Penktadienis' },
];

export const RoleDayDistributionModal: React.FC<RoleDayDistributionModalProps> = ({
  isOpen,
  onClose,
  config,
  onConfirm
}) => {
  if (!isOpen) return null;

  // Local state for role preferences
  const [rolesState, setRolesState] = useState<JobRole[]>(() => {
    const teachingRole = getSlotTeacherRole(config.roles);
    
    // Days that have lessons in weeklyLessons
    const daysWithLessons = [0, 1, 2, 3, 4].filter(d => 
      (config.weeklyLessons?.[d] || []).length > 0
    );

    return config.roles.map((r, idx) => {
      const isPrimary = idx === 0;
      const isTeacher = teachingRole && r.id === teachingRole.id;
      
      let defaultDays = r.schedulePreference?.days;
      if (!defaultDays || defaultDays.length === 0) {
        if (isTeacher && daysWithLessons.length > 0) {
          defaultDays = daysWithLessons;
        } else if (isPrimary) {
          defaultDays = [0, 1, 2, 3, 4]; // Monday to Friday
        } else {
          // Secondary role with small hours -> Wednesday default or days with lessons
          defaultDays = daysWithLessons.length > 0 ? daysWithLessons : [2];
        }
      }

      return {
        ...r,
        schedulePreference: {
          mode: r.schedulePreference?.mode || (isTeacher ? 'auto_after_lessons' : 'custom_times'),
          days: defaultDays,
          startTime: r.schedulePreference?.startTime || config.defaultStartTime || '08:00',
          endTime: r.schedulePreference?.endTime || '16:00',
          flexibleDistribution: r.schedulePreference?.flexibleDistribution || 'after_lessons',
          flexibleDays: r.schedulePreference?.flexibleDays || defaultDays
        }
      };
    });
  });

  const toggleDayForRole = (roleId: string, dayOffset: number) => {
    setRolesState(prev => prev.map(r => {
      if (r.id !== roleId) return r;
      const currentDays = r.schedulePreference?.days || [];
      const isSelected = currentDays.includes(dayOffset);
      
      let newDays: number[];
      if (isSelected) {
        newDays = currentDays.filter(d => d !== dayOffset);
        // Don't allow 0 days
        if (newDays.length === 0) newDays = [dayOffset];
      } else {
        newDays = [...currentDays, dayOffset].sort((a, b) => a - b);
      }

      return {
        ...r,
        schedulePreference: {
          ...r.schedulePreference!,
          days: newDays,
          flexibleDays: r.schedulePreference?.flexibleDistribution === 'after_lessons' ? newDays : r.schedulePreference?.flexibleDays
        }
      };
    }));
  };

  const setPresetDays = (roleId: string, days: number[]) => {
    setRolesState(prev => prev.map(r => {
      if (r.id !== roleId) return r;
      return {
        ...r,
        schedulePreference: {
          ...r.schedulePreference!,
          days,
          flexibleDays: days
        }
      };
    }));
  };

  const handleFlexDistChange = (roleId: string, dist: 'after_lessons' | 'equal_days' | 'specific_day', specificDay?: number) => {
    setRolesState(prev => prev.map(r => {
      if (r.id !== roleId) return r;
      const currentDays = r.schedulePreference?.days || [2];
      return {
        ...r,
        schedulePreference: {
          ...r.schedulePreference!,
          flexibleDistribution: dist,
          flexibleDays: dist === 'specific_day' && specificDay !== undefined ? [specificDay] : currentDays
        }
      };
    }));
  };

  // Calculate day-by-day preview
  const preview = useMemo(() => {
    const totalWeeklyTarget = rolesState.reduce((sum, r) => sum + (r.hours * 60) + r.minutes, 0);
    const dayTargets = calculateDailyTargets(totalWeeklyTarget, config.shortFriday ?? true);

    const dayBreakdowns = WEEKDAYS.map(day => {
      const dayOffset = day.offset;
      const activeRolesOnDay: { role: JobRole; targetMinutes: number; isLesson: boolean; lessonCount: number; flexMinutes: number }[] = [];

      rolesState.forEach(role => {
        const roleDays = role.schedulePreference?.days || [];
        const isScheduledToday = roleDays.includes(dayOffset);
        const roleTotalMin = (role.hours * 60) + role.minutes;

        // Check if role is teacher
        const isTeachingRole = role.id === getSlotTeacherRole(rolesState)?.id;
        const dayLessons = isTeachingRole ? (config.weeklyLessons?.[dayOffset] || []) : [];
        const totalRoleLessons = isTeachingRole 
          ? (Object.values(config.weeklyLessons || {}) as number[][]).reduce((s: number, list: number[]) => s + (list ? list.length : 0), 0)
          : 0;

        if (isTeachingRole) {
          const lessonAccountedMin = Number(totalRoleLessons) * 60;
          const totalFlexMin = Math.max(0, roleTotalMin - lessonAccountedMin);
          
          const hasLessonsToday = dayLessons.length > 0;
          const flexDays = role.schedulePreference?.flexibleDays || roleDays;
          const hasFlexToday = flexDays.includes(dayOffset);

          if (hasLessonsToday || hasFlexToday || isScheduledToday) {
            const todayLessonMin = dayLessons.length * 60;
            const flexShare = flexDays.length > 0 && hasFlexToday 
              ? Math.round(totalFlexMin / flexDays.length) 
              : 0;
            
            const todayMin = todayLessonMin + flexShare;
            if (todayMin > 0) {
              activeRolesOnDay.push({
                role,
                targetMinutes: todayMin,
                isLesson: hasLessonsToday,
                lessonCount: dayLessons.length,
                flexMinutes: flexShare
              });
            }
          }
        } else if (isScheduledToday) {
          const perDay = Math.round(roleTotalMin / roleDays.length);
          activeRolesOnDay.push({
            role,
            targetMinutes: perDay,
            isLesson: false,
            lessonCount: 0,
            flexMinutes: 0
          });
        }
      });

      const totalDayMinutes = activeRolesOnDay.reduce((sum, item) => sum + item.targetMinutes, 0);
      const startMin = timeToMinutes(config.defaultStartTime || '08:00');
      const lunchDur = config.hasLunch ? (config.lunchDuration || 30) : 0;
      const estimatedEndMin = startMin + totalDayMinutes + lunchDur;

      return {
        day,
        activeRolesOnDay,
        totalDayMinutes,
        dayTarget: dayTargets[dayOffset],
        estimatedEndTime: minutesToTime(estimatedEndMin),
        isOverLimit: totalDayMinutes > 618 // > 10 val. 18 min.
      };
    });

    return { dayBreakdowns, totalWeeklyTarget };
  }, [rolesState, config]);

  const handleSaveAndGenerate = () => {
    onConfirm(rolesState);
  };

  const teachingRole = getSlotTeacherRole(rolesState);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-2xl w-full my-auto overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-linear-to-r from-blue-600 via-indigo-600 to-indigo-700 text-white p-4 sm:p-5 relative shrink-0">
          <button 
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-1.5 rounded-full transition-colors"
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 bg-white/20 rounded-lg backdrop-blur-xs">
              <Calendar size={18} />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-100">Grafiko sudarymas</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold">
            Kuriomis dienomis išdėlioti darbo laiką?
          </h2>
          <p className="text-xs text-blue-100 mt-1">
            Nurodykite, kuriomis savaitės dienomis dirbama pagal kiekvienas pareigas ir kaip apskaičiuoti lanksčias valandas.
          </p>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {/* List of Roles */}
          <div className="space-y-4">
            {rolesState.map((role, idx) => {
              const isPrimary = idx === 0;
              const isTeacher = teachingRole && role.id === teachingRole.id;
              const roleTotalMin = (role.hours * 60) + role.minutes;
              const pref = role.schedulePreference || { days: [0, 1, 2, 3, 4] };
              const selectedDays = pref.days || [];

              // Calculate teacher lessons & flexible hours breakdown
              let teacherLessonCount = 0;
              if (isTeacher && config.weeklyLessons) {
                teacherLessonCount = (Object.values(config.weeklyLessons) as number[][]).reduce((s: number, list: number[]) => s + (list ? list.length : 0), 0);
              }
              const teacherLessonAccountedMin = teacherLessonCount * 60;
              const teacherFlexibleMin = Math.max(0, roleTotalMin - teacherLessonAccountedMin);

              return (
                <div 
                  key={role.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isPrimary 
                      ? 'bg-blue-50/50 border-blue-200' 
                      : 'bg-gray-50/70 border-gray-200 hover:border-indigo-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg ${isPrimary ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
                        {isTeacher ? <GraduationCap size={16} /> : <Briefcase size={16} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-gray-900 text-sm">{role.title || `Pareigos #${idx + 1}`}</h4>
                          {isPrimary && (
                            <span className="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded-full">
                              Pagrindinės
                            </span>
                          )}
                          {isTeacher && (
                            <span className="text-[10px] bg-sky-100 text-sky-800 font-bold px-2 py-0.5 rounded-full border border-sky-200">
                              Pedagoginis
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-0.5">
                          Savaitės norma: <b className="text-gray-800">{formatDuration(roleTotalMin)}</b>
                        </div>
                      </div>
                    </div>

                    {/* Presets */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPresetDays(role.id, [0, 1, 2, 3, 4])}
                        className={`text-[10px] px-2 py-1 rounded border font-medium transition-colors ${
                          selectedDays.length === 5 
                            ? 'bg-indigo-600 text-white border-indigo-600 font-bold' 
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        Visos (I–V)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresetDays(role.id, [2])}
                        className={`text-[10px] px-2 py-1 rounded border font-medium transition-colors ${
                          selectedDays.length === 1 && selectedDays[0] === 2
                            ? 'bg-purple-600 text-white border-purple-600 font-bold' 
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        Tik trečiadienį
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresetDays(role.id, [0, 2, 4])}
                        className={`text-[10px] px-2 py-1 rounded border font-medium transition-colors ${
                          selectedDays.length === 3 && selectedDays.includes(0) && selectedDays.includes(2) && selectedDays.includes(4)
                            ? 'bg-indigo-600 text-white border-indigo-600 font-bold' 
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        I, III, V
                      </button>
                    </div>
                  </div>

                  {/* Day Checkboxes */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-700 block">
                      Pasirinkite darbo dienas:
                    </label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {WEEKDAYS.map(day => {
                        const isChecked = selectedDays.includes(day.offset);
                        const hasLessons = isTeacher && (config.weeklyLessons?.[day.offset] || []).length > 0;
                        const lessonCount = isTeacher ? (config.weeklyLessons?.[day.offset] || []).length : 0;

                        return (
                          <button
                            key={day.offset}
                            type="button"
                            onClick={() => toggleDayForRole(role.id, day.offset)}
                            className={`p-2 rounded-lg border text-center transition-all flex flex-col items-center justify-center relative ${
                              isChecked 
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs' 
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            <span className="text-xs font-bold">{day.short}</span>
                            <span className="text-[10px] opacity-80 truncate max-w-full">{day.full.slice(0, 4)}</span>
                            {hasLessons && (
                              <span className={`text-[9px] px-1 rounded-full mt-0.5 font-bold ${
                                isChecked ? 'bg-indigo-700 text-white' : 'bg-blue-100 text-blue-800'
                              }`}>
                                {lessonCount} pam.
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Teacher Specific: Contact Lessons & Flexible Hours Explanation */}
                  {isTeacher && (
                    <div className="mt-3 bg-white p-3 rounded-lg border border-sky-200 space-y-2 text-xs">
                      <div className="flex items-center justify-between border-b border-sky-100 pb-1.5">
                        <span className="font-bold text-sky-950 flex items-center gap-1.5">
                          <BookOpen size={13} className="text-blue-600" />
                          <span>Mokytojo darbo laiko skaidymas:</span>
                        </span>
                        <span className="text-gray-500 font-mono">
                          Norma: <b>{formatDuration(roleTotalMin)}</b>
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2 bg-sky-50/70 rounded border border-sky-100">
                          <div className="text-sky-800 font-semibold flex items-center justify-between">
                            <span>Kontaktinės pamokos:</span>
                            <b>{teacherLessonCount} pam. ({formatDuration(teacherLessonAccountedMin)})</b>
                          </div>
                          <p className="text-gray-500 text-[10px] mt-0.5">
                            1 pamoka = 1 val. darbo laiko apskaitoje (trunka 45 min.)
                          </p>
                        </div>

                        <div className="p-2 bg-purple-50/70 rounded border border-purple-100">
                          <div className="text-purple-800 font-semibold flex items-center justify-between">
                            <span>Lanksčios (nekontaktinės):</span>
                            <b className="text-purple-900">{formatDuration(teacherFlexibleMin)}</b>
                          </div>
                          <p className="text-gray-500 text-[10px] mt-0.5">
                            {formatDuration(roleTotalMin)} - {formatDuration(teacherLessonAccountedMin)} = <b>{formatDuration(teacherFlexibleMin)}</b>
                          </p>
                        </div>
                      </div>

                      {/* Where to place flexible hours */}
                      {teacherFlexibleMin > 0 && (
                        <div className="pt-2 border-t border-sky-100 space-y-1.5">
                          <label className="text-[11px] font-semibold text-gray-700 block">
                            Kur išdėlioti lanksčias valandas ({formatDuration(teacherFlexibleMin)}):
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleFlexDistChange(role.id, 'after_lessons')}
                              className={`p-2 rounded border text-left text-[11px] transition-all flex items-start gap-1.5 ${
                                pref.flexibleDistribution === 'after_lessons'
                                  ? 'bg-purple-600 text-white border-purple-600 font-semibold shadow-2xs'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              <Sparkles size={13} className="shrink-0 mt-0.5" />
                              <div>
                                <div className="font-bold">Po pamokų tą pačią dieną</div>
                                <div className={`text-[10px] ${pref.flexibleDistribution === 'after_lessons' ? 'text-purple-100' : 'text-gray-500'}`}>
                                  Lanksčios valandos pridedamos iškart po kontaktinių pamokų
                                </div>
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleFlexDistChange(role.id, 'equal_days')}
                              className={`p-2 rounded border text-left text-[11px] transition-all flex items-start gap-1.5 ${
                                pref.flexibleDistribution === 'equal_days'
                                  ? 'bg-purple-600 text-white border-purple-600 font-semibold shadow-2xs'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              <Calendar size={13} className="shrink-0 mt-0.5" />
                              <div>
                                <div className="font-bold">Paskirstyti tolygiai per dienas</div>
                                <div className={`text-[10px] ${pref.flexibleDistribution === 'equal_days' ? 'text-purple-100' : 'text-gray-500'}`}>
                                  Po lygiai per visas pasirinktas darbo dienas
                                </div>
                              </div>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Weekly Day-by-Day Balance Preview */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                <Clock size={14} className="text-blue-600" />
                <span>Savaitės dienų planas ir darbo pabaigos laikai:</span>
              </h4>
              <span className="text-[11px] text-gray-500">
                Pradžia: <b>{config.defaultStartTime || '08:00'}</b>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              {preview.dayBreakdowns.map(({ day, activeRolesOnDay, totalDayMinutes, estimatedEndTime, isOverLimit }) => (
                <div 
                  key={day.offset}
                  className={`p-2.5 rounded-lg border text-center transition-all flex flex-col justify-between ${
                    isOverLimit 
                      ? 'bg-red-50 border-red-200 text-red-900' 
                      : totalDayMinutes > 0 
                        ? 'bg-white border-gray-200 shadow-2xs' 
                        : 'bg-gray-100/60 border-gray-200/50 text-gray-400'
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold text-gray-800">{day.short} ({day.full})</div>
                    <div className="text-sm font-bold text-blue-700 my-1">
                      {totalDayMinutes > 0 ? formatDuration(totalDayMinutes) : 'Laisva'}
                    </div>
                  </div>

                  {totalDayMinutes > 0 ? (
                    <div className="space-y-1 pt-1.5 border-t border-gray-100">
                      <div className="text-[10px] text-gray-600">
                        Iki: <b className="text-gray-900 font-mono">{estimatedEndTime}</b>
                      </div>
                      <div className="flex flex-wrap gap-0.5 justify-center">
                        {activeRolesOnDay.map(({ role, targetMinutes }, i) => (
                          <span 
                            key={i} 
                            className="text-[9px] bg-blue-50 text-blue-800 px-1 py-0.2 rounded border border-blue-100 font-medium truncate max-w-full"
                            title={`${role.title}: ${formatDuration(targetMinutes)}`}
                          >
                            {role.title.slice(0, 8)}: {formatDuration(targetMinutes)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <span className="text-[10px] text-gray-400 italic">Nėra darbo</span>
                  )}
                </div>
              ))}
            </div>

            <div className="text-[11px] text-gray-500 flex items-center gap-1.5 pt-1">
              <Info size={13} className="text-blue-500 shrink-0" />
              <span>
                Grafikas bus sugeneruotas tiksliai pagal nustatytas dienas. Kiekvienos pareigos savaitinė norma bus išlaikyta 100%.
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-gray-50 border-t border-gray-200 p-4 px-5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-xl transition-colors"
          >
            Atšaukti
          </button>

          <button
            type="button"
            onClick={handleSaveAndGenerate}
            className="px-5 py-2.5 text-sm font-bold text-white bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl shadow-md transition-all flex items-center gap-2"
          >
            <Sparkles size={16} />
            <span>Išdėlioti darbo laikus ir atidaryti grafiką</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
