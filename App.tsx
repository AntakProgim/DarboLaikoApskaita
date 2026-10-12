import React, { useState, useMemo } from 'react';
import { DaySchedule, WorkConfig, JobRole, ExternalWorkplace } from './types';
import { generateSmartSchedule } from './services/geminiService';
import { DayCard } from './components/DayCard';
import { Summary } from './components/Summary';
import { TimeSelect } from './components/TimeSelect';
import { calculateSlotMinutes, minutesToTime, timeToMinutes, placeFlexibleHoursAfterLessons } from './utils/timeHelper';
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
  GraduationCap
} from 'lucide-react';

const App: React.FC = () => {
  const [config, setConfig] = useState<WorkConfig>({
    fullName: '',
    isTeacher: true, // Default to teacher mode based on user requirements
    roles: [{ id: '1', title: 'Mokytojas', hours: 36, minutes: 0, isPedagogical: true }],
    defaultStartTime: '08:00',
    hasLunch: true,
    lunchStartTime: '12:00',
    lunchEndTime: '12:30',
    lunchDuration: 30,
    hasOtherWorkplaces: false,
    otherWorkplaces: [{ id: 'ext-1', name: 'Kita ugdymo įstaiga' }]
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
  
  // Calculate total used minutes per role across the entire schedule
  const roleUsage = useMemo(() => {
    const usage: Record<string, number> = {};
    config.roles.forEach(r => usage[r.id] = 0);
    
    schedule.forEach(day => {
      day.slots.forEach(slot => {
        if (slot.type === 'work' && slot.roleId) {
          const dur = calculateSlotMinutes(slot.startTime, slot.endTime);
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
        roles: [...prev.roles, { id: Date.now().toString(), title: '', hours: 10, minutes: 0, isPedagogical: true }]
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
        config.otherWorkplaces
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
            <p className="text-xs text-gray-500">Išmanusis pamokų, lanksčių valandų ir kitų darboviečių planavimas.</p>
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

            {/* Teacher Toggle and Info Box */}
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
                  <span>Pedagoginis darbuotojas (Mokytojas)</span>
                </label>
                <span className="text-[10px] bg-sky-200 text-sky-900 px-2 py-0.5 rounded-full font-semibold">
                  Norma: 10 val. 18 min. / d.
                </span>
              </div>
              <p className="text-xs text-sky-800 leading-relaxed">
                Mokytojo darbo dienai taikoma maksimali <b>10 val. 18 min.</b> pedagoginio darbo norma. Pirmiausia suplanuojamos <b>pamokos</b>, o <b>lanksčios (nekontaktinės) valandos</b> ar kitos pareigos išdėstomos po pamokų ar laisvais tarpais. Pietų pertrauka į darbo laiką neįskaičiuojama.
              </p>
            </div>

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
                    
                    {/* Presets */}
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
                    {config.otherWorkplaces.map((place, idx) => (
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

            {/* Roles / Workload */}
            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <label className="block text-xs font-bold text-gray-700">Pareigos ir Savaitės Laiko Norma</label>
                {config.roles.length < 5 && (
                  <button onClick={handleAddRole} className="text-[10px] text-blue-600 hover:bg-blue-50 px-2 py-0.5 rounded flex items-center gap-1 font-medium transition-colors">
                    <Plus size={12}/> Pridėti pareigas
                  </button>
                )}
              </div>
              
              {config.roles.map((role) => {
                const validation = getRoleValidation(role);
                return (
                  <div key={role.id} className={`bg-white p-3 rounded-lg border shadow-sm transition-colors relative ${validation.time ? 'border-red-200 bg-red-50/50' : 'border-gray-200'}`}>
                    <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                      <div className="flex-grow min-w-[120px]">
                        <div className="flex items-center gap-2 border-b border-gray-200 pb-1">
                          <Briefcase size={14} className="text-gray-400"/>
                          <input
                            type="text"
                            value={role.title}
                            onChange={(e) => handleRoleChange(role.id, 'title', e.target.value)}
                            className="w-full bg-transparent focus:outline-none text-sm font-medium placeholder-gray-400"
                            placeholder="Pareigos (pvz. Mokytojas, Metodininkas)"
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
                            className="w-full p-1 border border-gray-300 rounded text-sm text-center focus:border-blue-500 outline-none"
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
                        {config.roles.length > 1 && (
                          <button onClick={() => handleRemoveRole(role.id)} className="p-1.5 text-gray-400 hover:text-red-500 ml-1">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {(validation.time || validation.warning) && (
                      <div className={`text-[10px] flex items-center gap-1 mt-1 ${validation.time ? 'text-red-600' : 'text-amber-600'}`}>
                        <AlertCircle size={10} /> {validation.time || validation.warning}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className={`p-3 rounded-lg border text-center ${totalWeeklyLoadMinutes > 60 * 60 ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-100'}`}>
              <p className="text-[10px] text-gray-500 uppercase font-bold">Bendra savaitės norma</p>
              <p className="text-lg font-bold text-gray-800">{formatTotalLoad(totalWeeklyLoadMinutes)}</p>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !isFormValid}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
              {loading ? 'Generuojama...' : 'Generuoti Grafiką'}
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