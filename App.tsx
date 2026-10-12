import React, { useState, useMemo } from 'react';
import { DaySchedule, WorkConfig, JobRole, ExternalWorkplace, WeekdayLessons, RoleCategory, RoleSchedulePreference } from './types';
import { generateSmartSchedule } from './services/geminiService';
import { DayCard } from './components/DayCard';
import { Summary } from './components/Summary';
import { TimeSelect } from './components/TimeSelect';
import { WeeklyLessonGrid } from './components/WeeklyLessonGrid';
import { calculateSlotMinutes, minutesToTime, timeToMinutes, placeFlexibleHoursAfterLessons, getSlotAccountedMinutes, formatDuration } from './utils/timeHelper';
import { exportToTXT } from './utils/exportHelper';
import { 
  Sparkles, 
  Loader2, 
  Plus, 
  Trash2, 
  Briefcase, 
  Building2, 
  AlertCircle, 
  Clock, 
  Coffee, 
  RotateCcw, 
  Download, 
  Copy, 
  CheckCircle2,
  BookOpen,
  GraduationCap,
  ArrowDownUp,
  UserCheck,
  Calendar,
  Settings2,
  Check
} from 'lucide-react';

const App: React.FC = () => {
  const [config, setConfig] = useState<WorkConfig>({
    fullName: '',
    isTeacher: true,
    roles: [
      { id: '1', title: 'Mokytojas', hours: 24, minutes: 0, isPedagogical: true, roleCategory: 'teacher' },
      { 
        id: '2', 
        title: 'Pailgintos dienos grupės auklėtojas', 
        hours: 10, 
        minutes: 0, 
        isPedagogical: true, 
        roleCategory: 'other',
        schedulePreference: {
          mode: 'auto_after_lessons',
          days: [0, 1, 2, 3, 4],
          startTime: '13:00',
          endTime: '15:00'
        }
      }
    ],
    defaultStartTime: '08:00',
    hasLunch: true,
    lunchStartTime: '12:00',
    lunchEndTime: '12:30',
    lunchDuration: 30,
    hasOtherWorkplaces: false,
    otherWorkplaces: [{ id: 'ext-1', name: 'Kita ugdymo įstaiga' }],
    weeklyLessons: {
      0: [1, 2, 3, 4],
      1: [1, 2, 3, 4],
      2: [1, 2, 3, 4],
      3: [1, 2, 3, 4],
      4: [1, 2, 3]
    }
  });

  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const mainScheduleMinutes = config.roles.reduce((sum, role) => {
    const officeMin = (role.hours * 60) + role.minutes;
    return sum + officeMin;
  }, 0);

  const totalWeeklyLoadMinutes = mainScheduleMinutes;
  
  // Calculate total used minutes per role across the entire schedule (1 pamoka = 60 min. darbo laiko normos)
  const roleUsage = useMemo(() => {
    const usage: Record<string, number> = {};
    config.roles.forEach(r => usage[r.id] = 0);
    
    schedule.forEach(day => {
      day.slots.forEach(slot => {
        if (slot.type === 'work' && slot.roleId) {
          const dur = getSlotAccountedMinutes(slot);
          usage[slot.roleId] = (usage[slot.roleId] || 0) + dur;
        }
      });
    });
    return usage;
  }, [schedule, config.roles]);

  const getRoleValidation = (role: JobRole) => {
    const errors: { title?: string; time?: string; warning?: string } = {};
    
    if (!role.title.trim()) {
      errors.title = "Būtina";
    }

    const totalMin = (role.hours * 60) + role.minutes;

    if (totalMin === 0) {
      errors.time = "Nurodykite laiką";
    } else if (totalMin > 60 * 60) {
      errors.time = ">60h";
    } else if (totalMin > 40 * 60) {
      errors.warning = ">40h";
    }

    return errors;
  };

  const formatTotalLoad = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} val. ${m} min.`;
  };

  const handleAddRole = () => {
    if (config.roles.length < 5) {
      setConfig(prev => ({
        ...prev,
        roles: [
          ...prev.roles,
          { 
            id: Date.now().toString(), 
            title: '', 
            hours: 8, 
            minutes: 0, 
            isPedagogical: true,
            roleCategory: 'other'
          }
        ]
      }));
    }
  };

  const handleRemoveRole = (id: string) => {
    if (config.roles.length > 1) {
      if (window.confirm("Pašalinti pareigas?")) {
        setConfig(prev => ({
          ...prev,
          roles: prev.roles.filter(r => r.id !== id)
        }));
      }
    }
  };

  const handleRoleChange = (id: string, field: keyof JobRole, value: string | number | boolean) => {
    setConfig(prev => ({
      ...prev,
      roles: prev.roles.map(r => {
        if (r.id !== id) return r;
        return { ...r, [field]: value };
      })
    }));
  };

  /**
   * Sort roles by workload descending (highest hours first)
   */
  const handleSortRolesByWorkload = () => {
    const sorted = [...config.roles].sort((a, b) => {
      const minA = a.hours * 60 + a.minutes;
      const minB = b.hours * 60 + b.minutes;
      return minB - minA;
    });
    setConfig(prev => ({ ...prev, roles: sorted }));
    showToast('Pareigos išrikiuotos: pagrindinės (su didžiausiu krūviu) viršuje.');
  };

  /**
   * Promote any role to primary role position (index 0)
   */
  const handleSetAsPrimary = (roleId: string) => {
    const target = config.roles.find(r => r.id === roleId);
    if (!target) return;
    const others = config.roles.filter(r => r.id !== roleId);
    setConfig(prev => ({
      ...prev,
      roles: [target, ...others]
    }));
    showToast(`„${target.title || 'Pareigos'}“ nustatytos pagrindinėmis pareigomis!`);
  };

  /**
   * Detect if any secondary role has higher workload than the primary role
   */
  const highestWorkloadRole = useMemo(() => {
    if (config.roles.length <= 1) return null;
    const primaryMin = (config.roles[0]?.hours || 0) * 60 + (config.roles[0]?.minutes || 0);
    let candidate: JobRole | null = null;
    let candidateMin = primaryMin;
    for (let i = 1; i < config.roles.length; i++) {
      const r = config.roles[i];
      const m = (r.hours * 60) + r.minutes;
      if (m > candidateMin) {
        candidate = r;
        candidateMin = m;
      }
    }
    return candidate;
  }, [config.roles]);

  /**
   * Update scheduling preference for secondary / smaller roles
   */
  const handleRolePreferenceChange = (roleId: string, updates: Partial<RoleSchedulePreference>) => {
    setConfig(prev => ({
      ...prev,
      roles: prev.roles.map(r => {
        if (r.id !== roleId) return r;
        const currentPref = r.schedulePreference || {
          mode: 'auto_after_lessons',
          days: [0, 1, 2, 3, 4],
          startTime: '13:00',
          endTime: '15:00'
        };
        return {
          ...r,
          schedulePreference: {
            ...currentPref,
            ...updates
          }
        };
      })
    }));
  };

  const handleTogglePreferenceDay = (roleId: string, dayOffset: number) => {
    const role = config.roles.find(r => r.id === roleId);
    const pref = role?.schedulePreference || {
      mode: 'custom_times',
      days: [0, 1, 2, 3, 4],
      startTime: '13:00',
      endTime: '15:00'
    };
    const currentDays = pref.days || [];
    const newDays = currentDays.includes(dayOffset)
      ? currentDays.filter(d => d !== dayOffset)
      : [...currentDays, dayOffset].sort((a, b) => a - b);
    
    handleRolePreferenceChange(roleId, { days: newDays });
  };
  
  const handleConfigUpdate = (newConfig: WorkConfig) => {
    setConfig(newConfig);
  };

  const handleLunchStartChange = (newStart: string) => {
    const dur = config.lunchDuration || 30;
    const newEnd = minutesToTime(timeToMinutes(newStart) + dur);
    setConfig(prev => ({
      ...prev,
      lunchStartTime: newStart,
      lunchEndTime: newEnd
    }));
  };

  const handleLunchEndChange = (newEnd: string) => {
    const dur = calculateSlotMinutes(config.lunchStartTime || '12:00', newEnd);
    setConfig(prev => ({
      ...prev,
      lunchEndTime: newEnd,
      lunchDuration: dur
    }));
  };

  const handleSetLunchPreset = (dur: number) => {
    const startMin = timeToMinutes(config.lunchStartTime || '12:00');
    const newEnd = minutesToTime(startMin + dur);
    setConfig(prev => ({
      ...prev,
      hasLunch: true,
      lunchDuration: dur,
      lunchEndTime: newEnd
    }));
  };

  const handleAddExternalWorkplace = () => {
    setConfig(prev => ({
      ...prev,
      otherWorkplaces: [
        ...prev.otherWorkplaces,
        { id: `ext-${Date.now()}`, name: 'Kita įstaiga' }
      ]
    }));
  };

  const handleUpdateExternalWorkplace = (id: string, name: string) => {
    setConfig(prev => ({
      ...prev,
      otherWorkplaces: prev.otherWorkplaces.map(w => w.id === id ? { ...w, name } : w)
    }));
  };

  const handleRemoveExternalWorkplace = (id: string) => {
    setConfig(prev => ({
      ...prev,
      otherWorkplaces: prev.otherWorkplaces.filter(w => w.id !== id)
    }));
  };

  const handleGenerate = async () => {
    if (!isFormValid) return;
    
    setLoading(true);
    try {
      const generated = await generateSmartSchedule(
        config.roles, 
        mainScheduleMinutes,
        config.defaultStartTime,
        config.lunchDuration,
        config.lunchStartTime,
        config.lunchEndTime,
        config.hasLunch,
        config.isTeacher,
        config.otherWorkplaces,
        config.weeklyLessons
      );
      setSchedule(generated);
      setHasGenerated(true);
    } catch (error) {
      console.error("Failed to generate", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDayUpdate = (updatedDay: DaySchedule) => {
    setSchedule(prev => prev.map(day => day.id === updatedDay.id ? updatedDay : day));
  };

  /**
   * Applies Monday's schedule to all other days (Tuesday - Friday)
   */
  const handleApplyMondayToAll = () => {
    const monday = schedule.find(d => d.dateOffset === 0 || d.dayName === 'Pirmadienis') || schedule[0];
    if (!monday || monday.slots.length === 0) {
      showToast('Pirmadienis neturi suplanuotų veiklų.');
      return;
    }

    const updated = schedule.map(day => {
      if (day.id === monday.id) return day;
      return {
        ...day,
        slots: monday.slots.map((s, idx) => ({
          ...s,
          id: `slot-${day.dateOffset}-${Date.now()}-${idx}`
        }))
      };
    });

    setSchedule(updated);
    showToast('Pirmadienio darbo laikas pritaikytas antradieniui – penktadieniui!');
  };

  const handleCopyDayToOthers = (sourceDay: DaySchedule) => {
    if (sourceDay.slots.length === 0) {
      showToast('Ši diena neturi veiklų.');
      return;
    }

    const updated = schedule.map(day => {
      if (day.id === sourceDay.id) return day;
      return {
        ...day,
        slots: sourceDay.slots.map((s, idx) => ({
          ...s,
          id: `slot-${day.dateOffset}-${Date.now()}-${idx}`
        }))
      };
    });

    setSchedule(updated);
    showToast(`${sourceDay.dayName} darbo laikas pritaikytas visoms kitoms dienoms!`);
  };

  /**
   * Distribute flexible non-contact hours across week outside lesson times
   */
  const handleDistributeFlexibleHours = () => {
    const targetMin = mainScheduleMinutes;
    const currentUsedMin = (Object.values(roleUsage) as number[]).reduce((a: number, b: number) => a + b, 0);
    const neededMin = Math.max(0, targetMin - currentUsedMin);

    if (neededMin === 0) {
      showToast('Visos valandos jau suplanuotos.');
      return;
    }

    const minPerDay = Math.ceil(neededMin / 5);
    const primaryRoleId = config.roles[0]?.id || '';

    const updatedSchedule = schedule.map(day => ({
      ...day,
      slots: placeFlexibleHoursAfterLessons(day.slots, minPerDay, primaryRoleId)
    }));

    setSchedule(updatedSchedule);
    showToast('Lanksčios valandos sėkmingai paskirstytos po pamokų!');
  };

  const isFormValid = useMemo(() => {
    const hasName = config.fullName.trim() !== '';
    const rolesValid = config.roles.every(r => {
      const validation = getRoleValidation(r);
      return !validation.title && !validation.time;
    });
    const totalValid = mainScheduleMinutes > 0;
    return hasName && rolesValid && totalValid;
  }, [config.fullName, config.roles, mainScheduleMinutes]);

  const handleReset = () => {
    if (window.confirm("Grįžus į redagavimą, dabartinis grafikas bus ištrintas. Tęsti?")) {
      setHasGenerated(false);
    }
  };

  return (
    <div className="w-full mx-auto p-4 font-sans bg-transparent">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 text-sm font-medium animate-fade-in border border-gray-700">
          <CheckCircle2 size={16} className="text-green-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
      
      {!hasGenerated ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 w-full animate-fade-in max-w-3xl mx-auto">
          <div className="mb-6 text-center">
            <h2 className="text-xl font-bold text-gray-800">Pedagoginio ir darbo laiko grafikas</h2>
            <p className="text-xs text-gray-500">Išmanusis pamokų, lanksčių valandų ir kitų pareigų planavimas.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Darbuotojas <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={config.fullName}
                onChange={(e) => setConfig({ ...config, fullName: e.target.value })}
                className="w-full p-2.5 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none border-gray-300"
                placeholder="Vardas Pavardė"
              />
            </div>

            {/* Teacher / Educational Specialist Toggle and Info Box */}
            <div className="bg-sky-50/80 p-3.5 rounded-xl border border-sky-200 space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-sky-950">
                  <input
                    type="checkbox"
                    checked={config.isTeacher}
                    onChange={(e) => setConfig({ ...config, isTeacher: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <GraduationCap size={18} className="text-blue-600" />
                  <span>Pedagoginis darbuotojas (Mokytojas / Pagalbos specialistas)</span>
                </label>
                <span className="text-[10px] bg-sky-200 text-sky-900 px-2 py-0.5 rounded-full font-semibold">
                  Norma: 10 val. 18 min. / d.
                </span>
              </div>
              <p className="text-xs text-sky-800 leading-relaxed">
                Pedagoginio darbo dienai taikoma maksimali <b>10 val. 18 min.</b> norma. Pirmiausia suplanuokite <b>pamokų ar užsiėmimų laikus</b> savaitės dienomis, o <b>lanksčias valandas</b> (pasiruošimas, metodinė veikla) ir <b>kitas pareigas</b> sistema sudėlios po pamokų ar laisvu laiku.
              </p>
            </div>

            {/* ROLES / WORKLOAD SECTION WITH PRIMARY ROLE GUIDANCE */}
            <div className="space-y-2.5 pt-1">
              <div className="flex flex-wrap justify-between items-end gap-1">
                <div>
                  <label className="block text-xs font-bold text-gray-800 uppercase tracking-wide">
                    Pareigos ir Savaitės Laiko Norma
                  </label>
                  <p className="text-[11px] text-gray-500">Nurodykite pareigas ir joms tenkančias savaitės valandas.</p>
                </div>
                
                <div className="flex items-center gap-2">
                  {config.roles.length > 1 && (
                    <button
                      type="button"
                      onClick={handleSortRolesByWorkload}
                      className="text-[11px] text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded font-medium flex items-center gap-1 border border-blue-200 transition-colors"
                      title="Išrikiuoti pareigas, kad didžiausias krūvis būtų viršuje"
                    >
                      <ArrowDownUp size={12} /> Rūšiuoti pagal krūvį
                    </button>
                  )}
                  {config.roles.length < 5 && (
                    <button 
                      type="button"
                      onClick={handleAddRole} 
                      className="text-[11px] text-blue-600 hover:bg-blue-50 px-2 py-0.5 rounded flex items-center gap-1 font-semibold transition-colors"
                    >
                      <Plus size={13}/> Pridėti pareigas
                    </button>
                  )}
                </div>
              </div>

              {/* Recommendation Callout & Proactive Higher Workload Alert */}
              {highestWorkloadRole && (
                <div className="bg-amber-100/90 border border-amber-300 p-3 rounded-xl text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2 shadow-xs animate-fade-in">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="text-amber-700 shrink-0" />
                    <span>
                      Pareigoms <b>„{highestWorkloadRole.title || 'Papildomos pareigos'}“</b> nurodytas didesnis darbo laikas ({highestWorkloadRole.hours} val. {highestWorkloadRole.minutes > 0 ? `${highestWorkloadRole.minutes} min.` : ''}). Rekomenduojama jas nurodyti kaip pagrindines pareigas.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSetAsPrimary(highestWorkloadRole.id)}
                    className="bg-amber-700 hover:bg-amber-800 text-white font-bold px-2.5 py-1 rounded-md text-xs flex items-center gap-1 transition-colors shadow-2xs shrink-0"
                  >
                    <ArrowDownUp size={12} />
                    <span>Iškelti į 1-ą vietą</span>
                  </button>
                </div>
              )}

              <div className="bg-amber-50/90 border border-amber-200 p-3 rounded-xl text-xs text-amber-950 flex items-start gap-2.5">
                <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold text-amber-900">
                    💡 Rekomendacija: Pirmiausia nurodykite pagrindines pareigas
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Pirmose pareigose nurodykite pareigas, kuriose yra <b>didesnis darbo laikas</b> (pvz., <i>Mokytojas</i> 24 val. ar <i>Pagalbos specialistas</i> 20 val.). Mažesnių (papildomų) pareigų laikus galite nurodyti patys arba leisti sistemai sudėlioti po pamokų.
                  </p>
                </div>
              </div>
              
              {/* Roles List */}
              <div className="space-y-2.5">
                {config.roles.map((role, index) => {
                  const validation = getRoleValidation(role);
                  const isPrimary = index === 0;
                  const pref = role.schedulePreference || {
                    mode: 'auto_after_lessons',
                    days: [0, 1, 2, 3, 4],
                    startTime: '13:00',
                    endTime: '15:00'
                  };

                  const roleTargetMin = (role.hours * 60) + role.minutes;
                  const prefDaysCount = (pref.days || []).length;
                  const prefSlotMin = calculateSlotMinutes(pref.startTime || '13:00', pref.endTime || '15:00');
                  const prefTotalMin = prefDaysCount * prefSlotMin;

                  const WEEKDAY_BTNS = [
                    { offset: 0, label: 'Pr' },
                    { offset: 1, label: 'An' },
                    { offset: 2, label: 'Tr' },
                    { offset: 3, label: 'Kt' },
                    { offset: 4, label: 'Pn' }
                  ];

                  return (
                    <div 
                      key={role.id} 
                      className={`p-3 rounded-lg border shadow-xs transition-colors relative ${
                        isPrimary 
                          ? 'bg-blue-50/40 border-blue-200 ring-1 ring-blue-100' 
                          : validation.time ? 'border-red-200 bg-red-50/50' : 'bg-white border-gray-200'
                      }`}
                    >
                      {/* Priority Tag & Actions */}
                      <div className="flex flex-wrap items-center justify-between gap-1 pb-1 mb-1 border-b border-gray-100">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isPrimary ? (
                            <span className="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                              👑 1. Pagrindinės pareigos (didesnis krūvis)
                            </span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] bg-gray-100 text-gray-700 font-semibold px-2 py-0.5 rounded-full">
                                Mažesnės pareigos #{index + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleSetAsPrimary(role.id)}
                                className="text-[10px] text-blue-700 bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded border border-blue-200 font-medium transition-colors"
                                title="Nustatyti šias pareigas pagrindinėmis"
                              >
                                👑 Padaryti pagrindinėmis
                              </button>
                            </div>
                          )}

                          {/* Quick Role Category Selector */}
                          <div className="flex items-center gap-1 ml-1">
                            <button
                              type="button"
                              onClick={() => handleRoleChange(role.id, 'title', role.title || 'Mokytojas')}
                              className="text-[10px] text-gray-500 hover:text-blue-700 hover:underline"
                            >
                              Mokytojas
                            </button>
                            <span className="text-gray-300">•</span>
                            <button
                              type="button"
                              onClick={() => handleRoleChange(role.id, 'title', role.title || 'Pagalbos specialistas')}
                              className="text-[10px] text-gray-500 hover:text-blue-700 hover:underline"
                            >
                              Pagalbos specialistas
                            </button>
                          </div>
                        </div>

                        {config.roles.length > 1 && !isPrimary && (
                          <button 
                            type="button"
                            onClick={() => handleRemoveRole(role.id)} 
                            className="text-gray-400 hover:text-red-500 text-xs flex items-center gap-0.5 ml-auto"
                            title="Pašalinti pareigas"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>

                      {/* Title & Weekly Hours Inputs */}
                      <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap pt-1">
                        <div className="flex-grow min-w-[140px]">
                          <div className="flex items-center gap-2 border-b border-gray-200 pb-1">
                            <Briefcase size={14} className={isPrimary ? "text-blue-500" : "text-gray-400"}/>
                            <input
                              type="text"
                              value={role.title}
                              onChange={(e) => handleRoleChange(role.id, 'title', e.target.value)}
                              className="w-full bg-transparent focus:outline-none text-sm font-semibold placeholder-gray-400 text-gray-800"
                              placeholder={isPrimary ? "Pagrindinės pareigos (pvz. Mokytojas)" : "Mažesnės pareigos (pvz. Pailginta grupė, Būrelis)"}
                            />
                          </div>
                          {validation.title && <span className="text-[10px] text-red-500">{validation.title}</span>}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <div className="relative w-14">
                            <input
                              type="number"
                              min="0"
                              value={role.hours}
                              onChange={(e) => handleRoleChange(role.id, 'hours', Math.max(0, parseInt(e.target.value) || 0))}
                              className="w-full p-1 border border-gray-300 rounded text-sm text-center focus:border-blue-500 outline-none font-bold"
                            />
                            <span className="absolute right-0.5 top-0.5 text-[8px] text-gray-400">val</span>
                          </div>
                          <span className="text-gray-400">:</span>
                          <div className="relative w-14">
                            <input
                              type="number"
                              min="0"
                              max="59"
                              value={role.minutes}
                              onChange={(e) => handleRoleChange(role.id, 'minutes', Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                              className="w-full p-1 border border-gray-300 rounded text-sm text-center focus:border-blue-500 outline-none"
                            />
                            <span className="absolute right-0.5 top-0.5 text-[8px] text-gray-400">min</span>
                          </div>
                        </div>
                      </div>

                      {(validation.time || validation.warning) && (
                        <div className={`text-[10px] flex items-center gap-1 mt-1 ${validation.time ? 'text-red-600' : 'text-amber-600'}`}>
                          <AlertCircle size={10} /> {validation.time || validation.warning}
                        </div>
                      )}

                      {/* USER SPECIFIED SCHEDULE FOR SMALLER / SECONDARY ROLES */}
                      {!isPrimary && (
                        <div className="mt-2.5 pt-2 border-t border-gray-200/70 bg-gray-50/70 p-2.5 rounded-lg space-y-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-700 flex items-center gap-1 text-[11px]">
                              <Settings2 size={12} className="text-indigo-600" />
                              <span>Mažesnių pareigų laiko planavimas:</span>
                            </span>
                            <span className="text-[10px] text-gray-500">
                              Norma: <b>{formatTotalLoad(roleTargetMin)}</b>
                            </span>
                          </div>

                          {/* Mode Selector */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
                            <button
                              type="button"
                              onClick={() => handleRolePreferenceChange(role.id, { mode: 'custom_times' })}
                              className={`py-1 px-2 rounded-md border text-[11px] font-medium transition-colors text-left flex items-center gap-1.5 ${
                                pref.mode === 'custom_times'
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs font-semibold'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              <Clock size={12} />
                              <span>Nurodysiu konkrečius laikus</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRolePreferenceChange(role.id, { mode: 'auto_after_lessons' })}
                              className={`py-1 px-2 rounded-md border text-[11px] font-medium transition-colors text-left flex items-center gap-1.5 ${
                                pref.mode === 'auto_after_lessons'
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs font-semibold'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              <Sparkles size={12} />
                              <span>Sudėlioti po pamokų</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRolePreferenceChange(role.id, { mode: 'manual_in_schedule' })}
                              className={`py-1 px-2 rounded-md border text-[11px] font-medium transition-colors text-left flex items-center gap-1.5 ${
                                pref.mode === 'manual_in_schedule'
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs font-semibold'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                              }`}
                            >
                              <Briefcase size={12} />
                              <span>Susidėliosiu pats kortelėse</span>
                            </button>
                          </div>

                          {/* Custom Times Configuration: Days of Week + Time Range */}
                          {pref.mode === 'custom_times' && (
                            <div className="bg-white p-2 rounded-md border border-indigo-200 space-y-2 animate-fade-in">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold text-gray-600 block">Savaitės dienos:</span>
                                  <div className="flex items-center gap-1">
                                    {WEEKDAY_BTNS.map(day => {
                                      const isDayChecked = (pref.days || []).includes(day.offset);
                                      return (
                                        <button
                                          key={day.offset}
                                          type="button"
                                          onClick={() => handleTogglePreferenceDay(role.id, day.offset)}
                                          className={`w-7 h-6 rounded text-xs font-bold transition-all flex items-center justify-center ${
                                            isDayChecked 
                                              ? 'bg-indigo-600 text-white shadow-2xs' 
                                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                          }`}
                                          title={`Paskirti ${role.title} į šią savaitės dieną`}
                                        >
                                          {day.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <span className="text-[10px] font-semibold text-gray-600 block">Darbo laikas:</span>
                                  <div className="flex items-center gap-1">
                                    <TimeSelect 
                                      value={pref.startTime || '13:00'}
                                      onChange={(val) => handleRolePreferenceChange(role.id, { startTime: val })}
                                      selectClassName="w-12 p-0.5 text-xs rounded border-gray-300 font-medium"
                                    />
                                    <span className="text-gray-400 font-bold">-</span>
                                    <TimeSelect 
                                      value={pref.endTime || '15:00'}
                                      onChange={(val) => handleRolePreferenceChange(role.id, { endTime: val })}
                                      selectClassName="w-12 p-0.5 text-xs rounded border-gray-300 font-medium"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Calculated Summary vs Role Load */}
                              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-gray-100">
                                <span className="text-gray-600">
                                  Planuojama: <b>{prefDaysCount} d. × {formatDuration(prefSlotMin)}</b> = <b>{formatDuration(prefTotalMin)}</b>
                                </span>
                                <div>
                                  {prefTotalMin === roleTargetMin ? (
                                    <span className="text-green-600 font-bold flex items-center gap-1">
                                      <Check size={12} strokeWidth={3} /> Atitinka savaitės normą
                                    </span>
                                  ) : prefTotalMin < roleTargetMin ? (
                                    <span className="text-amber-700 font-medium">
                                      Liko suplanuoti: {formatDuration(roleTargetMin - prefTotalMin)}
                                    </span>
                                  ) : (
                                    <span className="text-red-600 font-medium">
                                      Viršija normą: +{formatDuration(prefTotalMin - roleTargetMin)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {pref.mode === 'auto_after_lessons' && (
                            <p className="text-[11px] text-gray-600 italic">
                              Sistema šių pareigų savaitės valandas tolygiai sudėlios po pamokų ir lanksčių valandų.
                            </p>
                          )}

                          {pref.mode === 'manual_in_schedule' && (
                            <p className="text-[11px] text-gray-600 italic">
                              Sugeneravus grafiką, šias valandas pridėsite patys norimomis dienomis paspaudę mygtuką <b>[+ {role.title || 'Pareigos'}]</b> kiekvienos dienos kortelėje.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* WEEKLY LESSON TIMETABLE SECTION */}
            {config.isTeacher && (
              <div className="space-y-1.5 pt-2">
                <WeeklyLessonGrid
                  value={config.weeklyLessons || {}}
                  onChange={(newLessons) => setConfig({ ...config, weeklyLessons: newLessons })}
                  primaryRoleTitle={config.roles[0]?.title || 'Pagrindinių pareigų'}
                />
              </div>
            )}

            {/* Work Start & Lunch Configuration Box */}
            <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs uppercase text-gray-600 font-bold mb-1 flex items-center gap-1">
                    <Clock size={13} className="text-blue-600"/> Darbo pradžia
                  </label>
                  <TimeSelect 
                    value={config.defaultStartTime}
                    onChange={(val) => setConfig({...config, defaultStartTime: val})}
                    selectClassName="w-14 p-1.5 text-sm rounded border-gray-300"
                  />
                </div>

                <div className="text-right">
                  <label className="block text-xs uppercase text-gray-600 font-bold mb-1 flex items-center justify-end gap-1">
                    <Coffee size={13} className="text-orange-500"/> Pietų pertrauka
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, hasLunch: true })}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                        config.hasLunch 
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs' 
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      Su pietumis
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, hasLunch: false, lunchDuration: 0 })}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                        !config.hasLunch 
                          ? 'bg-gray-700 text-white border-gray-700 shadow-xs' 
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      Be pietų
                    </button>
                  </div>
                </div>
              </div>

              {/* Specific Lunch Start & End Time Inputs */}
              {config.hasLunch && (
                <div className="pt-2 border-t border-gray-200/80 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-600">Pietų laikas (pradžia ir pabaiga):</span>
                    
                    {/* Presets: 20, 30, 45, 60 min */}
                    <div className="flex items-center gap-1">
                      {[20, 30, 45, 60].map(dur => (
                        <button
                          key={dur}
                          type="button"
                          onClick={() => handleSetLunchPreset(dur)}
                          className={`px-2 py-0.5 text-[11px] rounded border font-medium transition-colors ${
                            config.lunchDuration === dur 
                              ? 'bg-orange-100 text-orange-800 border-orange-300 font-bold' 
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {dur} min
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase">Nuo</span>
                      <TimeSelect 
                        value={config.lunchStartTime}
                        onChange={handleLunchStartChange}
                        selectClassName="w-12 p-1 text-xs rounded border-gray-300 font-medium"
                      />
                    </div>

                    <span className="text-gray-300 font-bold">-</span>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase">Iki</span>
                      <TimeSelect 
                        value={config.lunchEndTime}
                        onChange={handleLunchEndChange}
                        selectClassName="w-12 p-1 text-xs rounded border-gray-300 font-medium"
                      />
                    </div>

                    <div className="ml-auto text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-100">
                      {calculateSlotMinutes(config.lunchStartTime, config.lunchEndTime)} min. (neįskaitoma į darbo laiką)
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Other Workplaces Configuration */}
            <div className="bg-teal-50/70 p-3.5 rounded-xl border border-teal-200 space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-teal-950">
                  <input
                    type="checkbox"
                    checked={config.hasOtherWorkplaces}
                    onChange={(e) => setConfig({ ...config, hasOtherWorkplaces: e.target.checked })}
                    className="w-4 h-4 text-teal-600 rounded border-gray-300 focus:ring-teal-500"
                  />
                  <Building2 size={16} className="text-teal-600" />
                  <span>Dirbu kitoje darbovietėje / kitose įstaigose</span>
                </label>
                <span className="text-[10px] bg-teal-200 text-teal-900 px-2 py-0.5 rounded-full font-semibold">
                  Bendras DK limitas: 12 val. / d.
                </span>
              </div>

              {config.hasOtherWorkplaces && (
                <div className="pt-2 border-t border-teal-200/80 space-y-2">
                  <p className="text-xs text-teal-800">
                    Nurodykite kitas darbovietes. Jų darbo laikas bus žymimas atskira spalva ir sumuojamas į bendrą 12 val. dienos limitą:
                  </p>
                  <div className="space-y-1.5">
                    {config.otherWorkplaces.map((place) => (
                      <div key={place.id} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={place.name}
                          onChange={(e) => handleUpdateExternalWorkplace(place.id, e.target.value)}
                          placeholder="Įstaigos pavadinimas (pvz. Vilniaus muzikos mokykla)"
                          className="flex-grow p-1.5 text-xs bg-white border border-teal-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500 font-medium"
                        />
                        {config.otherWorkplaces.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveExternalWorkplace(place.id)}
                            className="p-1 text-gray-400 hover:text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddExternalWorkplace}
                      className="text-xs text-teal-700 hover:text-teal-900 font-semibold flex items-center gap-1 pt-1"
                    >
                      <Plus size={12} /> Pridėti dar vieną darbovietę
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={`p-3 rounded-lg border text-center ${totalWeeklyLoadMinutes > 60 * 60 ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-100'}`}>
              <p className="text-[10px] text-gray-500 uppercase font-bold">Bendra savaitės norma</p>
              <p className="text-lg font-bold text-gray-800">{formatTotalLoad(totalWeeklyLoadMinutes)}</p>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !isFormValid}
              className="w-full bg-blue-600 text-white py-3.5 rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
              {loading ? 'Generuojama...' : 'Generuoti Grafiką pagal pamokų tvarkaraštį'}
            </button>
          </div>
        </div>
      ) : (
        <div className="animate-fade-in space-y-6">
          {/* Toolbar */}
          <div className="flex flex-wrap justify-between items-center bg-white p-3 rounded-lg border border-gray-200 shadow-sm sticky top-2 z-20 gap-2">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-gray-700 text-sm sm:text-base truncate mr-1">{config.fullName}</h2>
              {config.isTeacher && (
                <span className="text-[11px] bg-sky-100 text-sky-800 font-bold px-2 py-0.5 rounded-full border border-sky-200 hidden sm:inline-flex items-center gap-1">
                  <GraduationCap size={12} /> Pedagoginis
                </span>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              {/* Teacher helper button: Distribute flexible hours outside lessons */}
              {config.isTeacher && (
                <button
                  onClick={handleDistributeFlexibleHours}
                  className="text-xs flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg border border-purple-200 transition-colors font-semibold"
                  title="Paskirstyti trūkstamas lanksčias (nekontaktines) valandas po pamokų"
                >
                  <Sparkles size={13} />
                  <span className="hidden sm:inline">Paskirstyti lanksčias valandas po pamokų</span>
                  <span className="sm:hidden">Lanksčios val.</span>
                </button>
              )}

              {/* Copy Monday to All Days button */}
              <button 
                onClick={handleApplyMondayToAll}
                className="text-xs flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors font-semibold"
                title="Pritaikyti pirmadienio darbo laiką visoms kitoms dienoms (antradieniui–penktadieniui)"
              >
                <Copy size={13} />
                <span>Taikyti pirmadienį visoms</span>
              </button>

              <button 
                onClick={() => exportToTXT(schedule, config)}
                className="text-xs flex items-center gap-1 text-gray-600 hover:text-green-600 bg-gray-50 hover:bg-green-50 px-3 py-1.5 rounded border border-gray-200 transition-colors"
                title="Atsisiųsti TXT"
              >
                <Download size={14}/> 
                <span className="hidden sm:inline">TXT</span>
              </button>
              
              <button 
                onClick={handleReset}
                className="text-xs flex items-center gap-1 text-gray-600 hover:text-blue-600 bg-gray-50 hover:bg-blue-50 px-3 py-1.5 rounded border border-gray-200 transition-colors"
              >
                <RotateCcw size={14}/> 
                <span className="hidden sm:inline">Naujas grafikas</span>
                <span className="sm:hidden">Naujas</span>
              </button>
            </div>
          </div>

          <Summary 
            schedule={schedule} 
            config={config} 
            onConfigUpdate={handleConfigUpdate}
          />
          
          {/* Color Legend & Labor Law Guidance */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-600 bg-white/70 p-3 rounded-lg border border-gray-200 shadow-2xs">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border border-sky-300 bg-sky-100"></div> Pamoka (kontaktinė)</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border border-purple-300 bg-purple-100"></div> Lanksčios (po pamokų)</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border border-teal-300 bg-teal-100"></div> Kita darbovietė</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border border-orange-300 bg-orange-100"></div> Pietų pertrauka</div>
            </div>

            <div className="text-[11px] text-gray-600">
              ⚖️ <b>Dienos normos:</b> Pedagoginis darbas maks. <b>10 val. 18 min.</b> | Bendra diena maks. <b>12 val.</b> | Pietūs neįskaičiuojami į darbo laiką.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
            {schedule.map((day) => (
              <DayCard 
                key={day.id} 
                day={day} 
                roles={config.roles}
                roleUsage={roleUsage}
                onChange={handleDayUpdate}
                onApplyMondayToAll={handleApplyMondayToAll}
                onCopyDayToOthers={handleCopyDayToOthers}
                isTeacher={config.isTeacher}
                otherWorkplaces={config.otherWorkplaces}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;