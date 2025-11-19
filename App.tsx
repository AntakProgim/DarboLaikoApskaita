import React, { useState, useMemo } from 'react';
import { DaySchedule, WorkConfig, JobRole } from './types';
import { generateSmartSchedule } from './services/geminiService';
import { DayCard } from './components/DayCard';
import { Summary } from './components/Summary';
import { TimeSelect } from './components/TimeSelect';
import { calculateSlotMinutes } from './utils/timeHelper';
import { exportToCSV } from './utils/exportHelper';
import { Sparkles, Loader2, Plus, Trash2, Briefcase, Building2, AlertCircle, Info, Clock, Coffee, RotateCcw, Download } from 'lucide-react';

const App: React.FC = () => {
  const [config, setConfig] = useState<WorkConfig>({
    fullName: '',
    roles: [{ id: '1', title: '', hours: 40, minutes: 0 }],
    defaultStartTime: '08:00',
    lunchDuration: 30 // Default 30 minutes
  });

  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const mainScheduleMinutes = config.roles.reduce((sum, role) => {
    const officeMin = (role.hours * 60) + role.minutes;
    return sum + officeMin;
  }, 0);

  // Total load is now just the main schedule
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
        roles: [...prev.roles, { id: Date.now().toString(), title: '', hours: 20, minutes: 0 }]
      }));
    }
  };

  const handleRemoveRole = (id: string) => {
    if (config.roles.length > 1) {
      if (window.confirm("Pašalinti?")) {
        setConfig(prev => ({
          ...prev,
          roles: prev.roles.filter(r => r.id !== id)
        }));
      }
    }
  };

  const handleRoleChange = (id: string, field: keyof JobRole, value: string | number) => {
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

  const handleGenerate = async () => {
    if (!isFormValid) return;
    
    setLoading(true);
    try {
      const generated = await generateSmartSchedule(
        config.roles, 
        mainScheduleMinutes,
        config.defaultStartTime,
        config.lunchDuration
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

  const isFormValid = useMemo(() => {
      const hasName = config.fullName.trim() !== '';
      const rolesValid = config.roles.every(r => {
          const validation = getRoleValidation(r);
          return !validation.title && !validation.time;
      });
      const totalValid = mainScheduleMinutes > 0;
      return hasName && rolesValid && totalValid;
  }, [config.fullName, config.roles, mainScheduleMinutes]);

  // Reset functionality
  const handleReset = () => {
      if (window.confirm("Grįžus į redagavimą, dabartinis grafikas bus ištrintas. Tęsti?")) {
        setHasGenerated(false);
      }
  };

  return (
    <div className="w-full mx-auto p-4 font-sans bg-transparent">
      
      {!hasGenerated ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 w-full animate-fade-in">
            <div className="mb-6 text-center">
                <h2 className="text-lg font-bold text-gray-800">Generuoti darbo grafiką</h2>
                <p className="text-xs text-gray-500">Užpildykite duomenis ir spauskite generuoti.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Darbuotojas <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={config.fullName}
                  onChange={(e) => setConfig({ ...config, fullName: e.target.value })}
                  className="w-full p-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none border-gray-300"
                  placeholder="Vardas Pavardė"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <div>
                        <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Pradžia</label>
                        <TimeSelect 
                            value={config.defaultStartTime}
                            onChange={(val) => setConfig({...config, defaultStartTime: val})}
                            selectClassName="w-full p-1.5 text-sm rounded border-gray-300"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Pietūs</label>
                        <div className="flex gap-1">
                             {[0, 30, 60].map(duration => (
                                 <button
                                    key={duration}
                                    onClick={() => setConfig({...config, lunchDuration: duration})}
                                    className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                                        config.lunchDuration === duration 
                                        ? 'bg-white border-blue-500 text-blue-700 shadow-sm' 
                                        : 'bg-gray-100 border-transparent text-gray-500 hover:bg-gray-200'
                                    }`}
                                 >
                                     {duration === 0 ? '-' : `${duration}m`}
                                 </button>
                             ))}
                        </div>
                    </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-end">
                   <label className="block text-xs font-bold text-gray-700">Pareigos ir Laikas</label>
                   {config.roles.length < 5 && (
                     <button onClick={handleAddRole} className="text-[10px] text-blue-600 hover:bg-blue-50 px-2 py-0.5 rounded flex items-center gap-1 font-medium transition-colors">
                       <Plus size={12}/> Pridėti
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
                                    placeholder="Pareigos"
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
                 <p className="text-[10px] text-gray-500 uppercase font-bold">Bendra savaitės trukmė</p>
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
            <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-200 shadow-sm sticky top-2 z-20">
                <h2 className="font-bold text-gray-700 text-sm sm:text-base truncate mr-2">{config.fullName}</h2>
                <div className="flex gap-2">
                    <button 
                        onClick={() => exportToCSV(schedule, config)}
                        className="text-xs flex items-center gap-1 text-gray-600 hover:text-green-600 bg-gray-50 hover:bg-green-50 px-3 py-1.5 rounded border border-gray-200 transition-colors"
                        title="Atsisiųsti CSV"
                    >
                        <Download size={14}/> 
                        <span className="hidden sm:inline">CSV</span>
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
            
            {/* Color Legend - Compact */}
            <div className="flex flex-wrap gap-3 justify-center text-xs text-gray-600 bg-white/50 p-2 rounded-lg">
               <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border border-gray-300 bg-white"></div> Biuras</div>
               <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border border-indigo-200 bg-indigo-50"></div> Nuotolinis</div>
               <div className="flex items-center gap-1"><div className="w-3 h-3 rounded border border-orange-200 bg-orange-50"></div> Pertrauka</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
              {schedule.map((day) => (
                <DayCard 
                  key={day.id} 
                  day={day} 
                  roles={config.roles}
                  roleUsage={roleUsage}
                  onChange={handleDayUpdate} 
                />
              ))}
            </div>
        </div>
      )}
    </div>
  );
};

export default App;