import React, { useMemo, useState } from 'react';
import { DaySchedule, DaySlot, JobRole, ExternalWorkplace, WorkCategory } from '../types';
import { 
  calculateDayNetMinutes, 
  formatDuration, 
  timeToMinutes, 
  minutesToTime, 
  sortSlots, 
  getRoleBreakdown,
  calculateSlotMinutes,
  shiftAllDaySlots,
  smartShiftOnSlotTimeChange,
  updateDayLunchTimes,
  getDayWorkDetails,
  STANDARD_LESSON_BELLS,
  placeFlexibleHoursAfterLessons,
  PEDAGOGICAL_DAILY_LIMIT_MINUTES,
  TOTAL_DAILY_LIMIT_MINUTES
} from '../utils/timeHelper';
import { 
  Briefcase, 
  Coffee, 
  Trash2, 
  Plus, 
  MonitorSmartphone, 
  Building2, 
  GripVertical, 
  History, 
  Copy, 
  Link2, 
  Unlink, 
  Clock, 
  Check,
  BookOpen,
  GraduationCap,
  Sparkles,
  AlertTriangle,
  ChevronDown
} from 'lucide-react';
import { TimeSelect } from './TimeSelect';

interface DayCardProps {
  day: DaySchedule;
  roles: JobRole[];
  roleUsage: Record<string, number>;
  onChange: (updatedDay: DaySchedule) => void;
  onApplyMondayToAll?: () => void;
  onCopyDayToOthers?: (sourceDay: DaySchedule) => void;
  isTeacher?: boolean;
  otherWorkplaces?: ExternalWorkplace[];
}

export const DayCard: React.FC<DayCardProps> = ({ 
  day, 
  roles, 
  roleUsage, 
  onChange, 
  onApplyMondayToAll,
  onCopyDayToOthers,
  isTeacher = false,
  otherWorkplaces = []
}) => {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggedSlotIndex, setDraggedSlotIndex] = useState<number | null>(null);
  const [autoShift, setAutoShift] = useState<boolean>(true);
  const [copiedNotification, setCopiedNotification] = useState<boolean>(false);
  const [showLessonPicker, setShowLessonPicker] = useState<boolean>(false);

  // Calculate detailed work statistics respecting labor limits
  const details = useMemo(() => getDayWorkDetails(day.slots, roles), [day.slots, roles]);
  const dailyRoleStats = useMemo(() => getRoleBreakdown(day.slots), [day.slots]);

  // Identify first slot and break slot
  const firstSlot = day.slots.length > 0 ? day.slots[0] : null;
  const breakSlot = day.slots.find(s => s.type === 'break');
  const breakMinutes = breakSlot ? calculateSlotMinutes(breakSlot.startTime, breakSlot.endTime) : 0;

  const handleAddSlot = (category: WorkCategory = 'general') => {
    const lastSlot = day.slots[day.slots.length - 1];
    let newStart = "08:00";
    
    if (lastSlot) {
      newStart = lastSlot.endTime;
    }

    const newSlot: DaySlot = {
      id: Date.now().toString(),
      startTime: newStart,
      endTime: minutesToTime(timeToMinutes(newStart) + 60),
      type: 'work',
      roleId: roles[0]?.id || '',
      isRemote: false,
      workCategory: category
    };
    
    const newSlots = [...day.slots, newSlot];
    const newDetails = getDayWorkDetails(newSlots, roles);

    if (newDetails.grandTotal > TOTAL_DAILY_LIMIT_MINUTES) {
      alert('Negalima viršyti 12 valandų maksimalaus darbo laiko per dieną (DK limitas).');
      return;
    }

    onChange({ ...day, slots: sortSlots(newSlots) });
  };

  /**
   * Add a specific school lesson (1-8 pamoka)
   */
  const handleAddLesson = (lessonNumber: number) => {
    setShowLessonPicker(false);
    const bell = STANDARD_LESSON_BELLS.find(b => b.number === lessonNumber);
    if (!bell) return;

    const newSlot: DaySlot = {
      id: `lesson-${Date.now()}-${lessonNumber}`,
      startTime: bell.startTime,
      endTime: bell.endTime,
      type: 'work',
      roleId: roles[0]?.id || '',
      isRemote: false,
      workCategory: 'lesson',
      lessonNumber
    };

    const newSlots = sortSlots([...day.slots, newSlot]);
    const newDetails = getDayWorkDetails(newSlots, roles);

    if (newDetails.isPedagogicalOverLimit) {
      alert('Dėmesio: viršytas 10 val. 18 min. pedagoginio darbo limitas per dieną.');
    }

    onChange({ ...day, slots: newSlots });
  };

  /**
   * Add flexible hours outside lesson hours (e.g. after lessons)
   */
  const handleAddFlexibleHours = () => {
    const newSlots = placeFlexibleHoursAfterLessons(day.slots, 60, roles[0]?.id || '');
    onChange({ ...day, slots: newSlots });
  };

  /**
   * Add a slot specifically for a secondary / smaller role
   */
  const handleAddRoleSlot = (roleId: string) => {
    const lastSlot = day.slots[day.slots.length - 1];
    let newStart = "14:00";
    if (lastSlot) {
      newStart = lastSlot.endTime;
    }
    const targetRole = roles.find(r => r.id === roleId);
    const pref = targetRole?.schedulePreference;
    if (pref?.mode === 'custom_times' && pref.startTime && pref.endTime) {
      newStart = pref.startTime;
    }
    const end = (pref?.mode === 'custom_times' && pref.endTime) 
      ? pref.endTime 
      : minutesToTime(timeToMinutes(newStart) + 60);

    const newSlot: DaySlot = {
      id: `sec-${Date.now()}-${roleId}`,
      startTime: newStart,
      endTime: end,
      type: 'work',
      roleId: roleId,
      isRemote: false,
      workCategory: 'general'
    };
    const newSlots = [...day.slots, newSlot];
    onChange({ ...day, slots: sortSlots(newSlots) });
  };

  /**
   * Add external workplace slot ("Darbas kitoje darbovietėje")
   */
  const handleAddExternalSlot = () => {
    const lastSlot = day.slots[day.slots.length - 1];
    const start = lastSlot ? lastSlot.endTime : "15:00";
    const startMin = timeToMinutes(start);
    
    const defaultName = otherWorkplaces.length > 0 ? otherWorkplaces[0].name : 'Kita darbovietė';

    const newSlot: DaySlot = {
      id: `ext-${Date.now()}`,
      startTime: start,
      endTime: minutesToTime(startMin + 90), // default 1.5h
      type: 'external',
      roleId: '',
      isRemote: false,
      isExternal: true,
      workplaceName: defaultName
    };

    const newSlots = sortSlots([...day.slots, newSlot]);
    const newDetails = getDayWorkDetails(newSlots, roles);

    if (newDetails.grandTotal > TOTAL_DAILY_LIMIT_MINUTES) {
      alert('Negalima viršyti 12 valandų bendro darbo laiko per dieną (DK limitas visose darbovietėse).');
      return;
    }

    onChange({ ...day, slots: newSlots });
  };

  const handleUpdateSlot = (slotId: string, updates: Partial<DaySlot>) => {
    const newSlots = day.slots.map(s => s.id === slotId ? { ...s, ...updates } : s);
    const newDetails = getDayWorkDetails(newSlots, roles);
    
    if (newDetails.grandTotal > TOTAL_DAILY_LIMIT_MINUTES) {
      alert('Negalima viršyti 12 valandų bendro darbo laiko per dieną.');
      return;
    }

    if (updates.startTime) {
      onChange({ ...day, slots: sortSlots(newSlots) });
    } else {
      onChange({ ...day, slots: newSlots });
    }
  };

  /**
   * Handle changes to slot start or end time with auto-shifting if enabled.
   */
  const handleSlotTimeChange = (slotId: string, field: 'startTime' | 'endTime', newValue: string) => {
    if (autoShift) {
      const newSlots = smartShiftOnSlotTimeChange(day.slots, slotId, field, newValue);
      const newDetails = getDayWorkDetails(newSlots, roles);
      if (newDetails.grandTotal > TOTAL_DAILY_LIMIT_MINUTES) {
        alert('Negalima viršyti 12 valandų bendro darbo laiko per dieną.');
        return;
      }
      onChange({ ...day, slots: sortSlots(newSlots) });
    } else {
      handleUpdateSlot(slotId, { [field]: newValue });
    }
  };

  /**
   * Quick shift of day's work start time
   */
  const handleDayStartChange = (newStart: string) => {
    if (!firstSlot) return;
    if (autoShift) {
      const delta = timeToMinutes(newStart) - timeToMinutes(firstSlot.startTime);
      const newSlots = shiftAllDaySlots(day.slots, delta);
      const newDetails = getDayWorkDetails(newSlots, roles);
      if (newDetails.grandTotal > TOTAL_DAILY_LIMIT_MINUTES) {
        alert('Negalima viršyti 12 valandų bendro darbo laiko per dieną.');
        return;
      }
      onChange({ ...day, slots: newSlots });
    } else {
      handleUpdateSlot(firstSlot.id, { startTime: newStart });
    }
  };

  /**
   * Quick change of day's lunch break
   */
  const handleQuickLunchChange = (field: 'startTime' | 'endTime', val: string) => {
    if (!breakSlot) return;
    if (autoShift) {
      const newSlots = smartShiftOnSlotTimeChange(day.slots, breakSlot.id, field, val);
      onChange({ ...day, slots: sortSlots(newSlots) });
    } else {
      handleUpdateSlot(breakSlot.id, { [field]: val });
    }
  };

  /**
   * Add a default lunch break slot to this day and shift subsequent times
   */
  const handleAddLunchBreak = (dur: number = 30) => {
    const lunchStart = "12:00";
    const lunchEnd = minutesToTime(timeToMinutes(lunchStart) + dur);
    const newSlots = updateDayLunchTimes(day.slots, lunchStart, lunchEnd);
    onChange({ ...day, slots: newSlots });
  };

  /**
   * Set lunch duration preset (20, 30, 45, 60 min)
   */
  const handleSetDayLunchDuration = (durationMinutes: number) => {
    if (!breakSlot) {
      handleAddLunchBreak(durationMinutes);
      return;
    }

    const startMin = timeToMinutes(breakSlot.startTime);
    const newEnd = minutesToTime(startMin + durationMinutes);
    if (autoShift) {
      const newSlots = smartShiftOnSlotTimeChange(day.slots, breakSlot.id, 'endTime', newEnd);
      onChange({ ...day, slots: sortSlots(newSlots) });
    } else {
      handleUpdateSlot(breakSlot.id, { endTime: newEnd });
    }
  };

  const handleRemoveSlot = (slotId: string) => {
    onChange({ ...day, slots: day.slots.filter(s => s.id !== slotId) });
  };

  const handleTriggerApplyMonday = () => {
    if (onApplyMondayToAll) {
      onApplyMondayToAll();
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2500);
    }
  };

  const handleTriggerCopyDay = () => {
    if (onCopyDayToOthers) {
      onCopyDayToOthers(day);
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2500);
    }
  };

  // Drag and Drop Handlers
  const onDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('slot-index', index.toString());
    e.dataTransfer.effectAllowed = 'move';
    setDraggedSlotIndex(index);
  };

  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      if (draggedSlotIndex === index) return;
      setDragOverIndex(index);
    }
  };

  const onDragEnd = () => {
    setDragOverIndex(null);
    setDraggedSlotIndex(null);
  };

  const onDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    setDraggedSlotIndex(null);
    
    const dragIndexStr = e.dataTransfer.getData('slot-index');
    const dragIndex = parseInt(dragIndexStr, 10);
    
    if (isNaN(dragIndex) || dragIndex === dropIndex) return;

    const newSlots = [...day.slots];
    const [movedSlot] = newSlots.splice(dragIndex, 1);
    newSlots.splice(dropIndex, 0, movedSlot);
    
    onChange({ ...day, slots: newSlots });
  };

  return (
    <div className={`bg-white rounded-xl shadow-sm border flex flex-col h-full hover:shadow-md transition-shadow relative ${
      details.isPedagogicalOverLimit || details.isTotalOverLimit ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-200'
    }`}>
      {/* Header */}
      <div className="p-4 pb-3 border-b border-gray-100">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold uppercase ${
              day.dateOffset === 0 ? 'bg-blue-600 text-white shadow-xs' : 'bg-gray-100 text-gray-700'
            }`}>
              {day.dayName.substring(0, 3)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-gray-800 text-sm">{day.dayName}</h3>
                {day.dateOffset === 0 && (
                  <span className="text-[10px] bg-blue-100 text-blue-800 font-semibold px-1.5 py-0.2 rounded">
                    Pagrindinė
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Time & Limits stats */}
          <div className="text-right">
            {/* Pedagogical work duration */}
            <div className="flex items-baseline justify-end gap-1">
              <span className={`text-sm font-bold font-mono ${details.isPedagogicalOverLimit ? 'text-red-600 font-extrabold' : 'text-gray-900'}`}>
                {formatDuration(details.pedagogicalMinutes)}
              </span>
              {isTeacher && (
                <span className="text-[10px] text-gray-400 font-mono">/ 10h 18m</span>
              )}
            </div>

            {/* Remaining to pedagogical limit (10h 18m) */}
            {isTeacher && (
              <div className="text-[10px] text-gray-400 font-medium flex items-center justify-end gap-1 mt-0.5" title="Maksimali pedagoginio darbo norma: 10 val. 18 min. Pietų laikas neįskaičiuojamas.">
                <History size={10} />
                <span className="opacity-70">Liko ped.:</span>
                <span className={`${details.isPedagogicalOverLimit ? 'text-red-600 font-bold' : details.remainingPedagogical < 60 ? 'text-amber-600 font-bold' : 'text-gray-600'}`}>
                  {details.isPedagogicalOverLimit ? 'VIRŠYTA' : formatDuration(details.remainingPedagogical)}
                </span>
              </div>
            )}

            {/* If has external workplace, show total day work */}
            {details.externalMinutes > 0 && (
              <div className="text-[10px] font-medium text-teal-700 flex items-center justify-end gap-1 mt-0.5" title="Bendra darbo diena su kitomis darbovietėmis (maks. 12 val.)">
                <Building2 size={10} />
                <span>Viso: {formatDuration(details.grandTotal)} / 12h</span>
              </div>
            )}
          </div>
        </div>

        {/* Warning Banners if Limits Exceeded */}
        {details.isPedagogicalOverLimit && (
          <div className="mb-2 bg-red-50 border border-red-200 text-red-700 p-1.5 rounded-md text-[11px] flex items-center gap-1.5 font-medium">
            <AlertTriangle size={13} className="shrink-0 text-red-600" />
            <span>Viršyta 10 val. 18 min. pedagoginio darbo norma!</span>
          </div>
        )}

        {details.isTotalOverLimit && (
          <div className="mb-2 bg-red-50 border border-red-200 text-red-700 p-1.5 rounded-md text-[11px] flex items-center gap-1.5 font-medium">
            <AlertTriangle size={13} className="shrink-0 text-red-600" />
            <span>Viršytas 12 val. maksimalus darbo laikas per dieną!</span>
          </div>
        )}

        {/* Action button: Apply Monday to all days or copy day */}
        <div className="flex items-center justify-between gap-1 pt-1 border-t border-gray-50">
          {day.dateOffset === 0 && onApplyMondayToAll ? (
            <button
              onClick={handleTriggerApplyMonday}
              className="text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold px-2 py-1 rounded-md border border-blue-200 transition-colors flex items-center gap-1 shadow-2xs"
              title="Kopijuoti pirmadienio darbo laiką į antradienį, trečiadienį, ketvirtadienį ir penktadienį"
            >
              {copiedNotification ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
              <span>{copiedNotification ? 'Pritaikyta!' : 'Taikyti visoms dienoms'}</span>
            </button>
          ) : onCopyDayToOthers ? (
            <button
              onClick={handleTriggerCopyDay}
              className="text-[11px] text-gray-500 hover:text-blue-600 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-colors flex items-center gap-1"
              title="Kopijuoti šios dienos laiką į kitas dienas"
            >
              {copiedNotification ? <Check size={11} className="text-green-600" /> : <Copy size={11} />}
              <span>{copiedNotification ? 'Nukopijuota!' : 'Kopijuoti į kitas'}</span>
            </button>
          ) : <div />}

          {/* Auto-shift toggle button */}
          <button
            onClick={() => setAutoShift(!autoShift)}
            className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 font-medium transition-all ${
              autoShift 
                ? 'bg-blue-50/80 border-blue-200 text-blue-700 hover:bg-blue-100' 
                : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'
            }`}
            title={autoShift 
              ? 'Poslinkis ĮJUNGTAS: Pakeitus darbo pradžios ar pietų laiką, kiti laikai pasislinks automatiškai išlaikant trukmes' 
              : 'Poslinkis IŠJUNGTAS: Keičiamas tik konkretus laukelis'
            }
          >
            {autoShift ? <Link2 size={11} className="text-blue-600" /> : <Unlink size={11} />}
            <span>{autoShift ? 'Surišti laikai' : 'Atskirai'}</span>
          </button>
        </div>

        {/* Quick Shift Bar: Day Start & Lunch */}
        {day.slots.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-gray-100 bg-gray-50/70 p-2 rounded-lg space-y-1.5 text-xs">
            {/* Start Time Quick Edit */}
            {firstSlot && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-gray-600 flex items-center gap-1">
                  <Clock size={11} className="text-blue-600" /> Pradžia:
                </span>
                <TimeSelect
                  value={firstSlot.startTime}
                  onChange={handleDayStartChange}
                  selectClassName="w-11 py-0.5 px-0.5 text-xs rounded border-gray-300 font-medium"
                />
              </div>
            )}

            {/* Lunch Break Quick Edit */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-gray-600 flex items-center gap-1">
                  <Coffee size={11} className="text-orange-500" /> Pietūs:
                </span>
                {breakSlot ? (
                  <div className="flex items-center gap-1">
                    <TimeSelect
                      value={breakSlot.startTime}
                      onChange={(val) => handleQuickLunchChange('startTime', val)}
                      selectClassName="w-11 py-0.5 px-0.5 text-xs rounded border-gray-300 font-medium"
                    />
                    <span className="text-gray-400 text-[10px]">-</span>
                    <TimeSelect
                      value={breakSlot.endTime}
                      onChange={(val) => handleQuickLunchChange('endTime', val)}
                      selectClassName="w-11 py-0.5 px-0.5 text-xs rounded border-gray-300 font-medium"
                    />
                    <span className="text-[10px] text-gray-400 font-mono">({breakMinutes}m)</span>
                    <button
                      onClick={() => handleRemoveSlot(breakSlot.id)}
                      className="text-gray-300 hover:text-red-500 p-0.5 rounded transition-colors ml-0.5"
                      title="Pašalinti pietų pertrauką"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleAddLunchBreak(30)}
                    className="text-[10px] text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded font-medium transition-colors"
                  >
                    + Pridėti pietus
                  </button>
                )}
              </div>

              {/* Quick Lunch Duration Presets: 20, 30, 45, 60 min */}
              <div className="flex items-center justify-between pt-0.5 border-t border-gray-200/50">
                <span className="text-[10px] text-gray-400 font-medium">Trukmė:</span>
                <div className="flex items-center gap-1">
                  {[20, 30, 45, 60].map(dur => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => handleSetDayLunchDuration(dur)}
                      className={`px-1.5 py-0.2 text-[9px] rounded border transition-colors ${
                        breakSlot && breakMinutes === dur
                          ? 'bg-orange-200 text-orange-900 border-orange-300 font-bold'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                      title={`Nustatyti ${dur} min. pietų pertrauką`}
                    >
                      {dur}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Role Breakdown Header */}
        {details.pedagogicalMinutes > 0 && (
          <div className="bg-gray-50 rounded-lg p-2 space-y-1 mt-2 border border-gray-100">
            {roles.map(role => {
              const mins = dailyRoleStats[role.id];
              if (!mins) return null;
              return (
                <div key={role.id} className="flex justify-between items-center text-xs">
                  <span className="text-gray-600 font-medium truncate max-w-[150px]">{role.title}</span>
                  <span className="font-mono text-gray-800">{formatDuration(mins)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Slots List */}
      <div className="p-4 space-y-2 flex-grow">
        {day.slots.map((slot, index) => {
          const currentRole = roles.find(r => r.id === slot.roleId);
          let isOverBudget = false;
          
          if (slot.type === 'work' && currentRole) {
            const targetMin = (currentRole.hours * 60) + currentRole.minutes;
            const usedMin = roleUsage[currentRole.id] || 0;
            if (usedMin > targetMin + 5) {
              isOverBudget = true;
            }
          }

          const isDragged = draggedSlotIndex === index;
          const isDropTarget = dragOverIndex === index && !isDragged;
          const showTopIndicator = isDropTarget && draggedSlotIndex !== null && draggedSlotIndex > index;
          const showBottomIndicator = isDropTarget && draggedSlotIndex !== null && draggedSlotIndex < index;

          const isExternal = slot.type === 'external' || slot.isExternal;
          const isLesson = slot.workCategory === 'lesson';
          const isFlexible = slot.workCategory === 'flexible';

          return (
            <div 
              key={slot.id}
              onDragOver={(e) => onDragOver(e, index)}
              onDrop={(e) => onDrop(e, index)}
              className="transition-all duration-200 ease-in-out"
            >
              {showTopIndicator && (
                <div className="w-full h-1 bg-blue-500 rounded-full mx-auto mb-2 animate-pulse shadow-sm" />
              )}

              <div 
                draggable
                onDragStart={(e) => onDragStart(e, index)}
                onDragEnd={onDragEnd}
                className={`relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all ${
                  slot.type === 'break' 
                    ? 'bg-orange-50 border-orange-200' 
                    : isExternal
                      ? 'bg-teal-50/80 border-teal-200'
                      : isLesson
                        ? 'bg-sky-50/80 border-sky-200'
                        : isFlexible
                          ? 'bg-purple-50/70 border-purple-200'
                          : isOverBudget
                            ? 'bg-red-50 border-red-200'
                            : slot.isRemote 
                              ? 'bg-indigo-50 border-indigo-100' 
                              : 'bg-white border-gray-200'
                } 
                ${isDragged ? 'opacity-50 border-dashed border-blue-400 bg-blue-50 scale-[0.99]' : ''}
                ${isDropTarget && !showTopIndicator && !showBottomIndicator ? 'ring-2 ring-blue-400 ring-offset-2' : ''}
                `}
              >
                <div className="flex items-center justify-between w-full gap-2">
                  {/* Drag Handle */}
                  <div 
                    className="text-gray-300 cursor-grab hover:text-gray-500 flex-shrink-0 active:cursor-grabbing"
                    title="Perkelti"
                  >
                    <GripVertical size={14} />
                  </div>

                  {/* Time Range */}
                  <div className="flex items-center gap-1">
                    <TimeSelect 
                      value={slot.startTime} 
                      onChange={(v) => handleSlotTimeChange(slot.id, 'startTime', v)} 
                      selectClassName="w-12 py-1 px-0.5 text-xs rounded border-gray-300 focus:ring-1"
                    />
                    <span className="text-gray-300 text-xs">-</span>
                    <TimeSelect 
                      value={slot.endTime} 
                      onChange={(v) => handleSlotTimeChange(slot.id, 'endTime', v)} 
                      selectClassName="w-12 py-1 px-0.5 text-xs rounded border-gray-300 focus:ring-1"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {/* Toggle Remote (Only for regular work) */}
                    {slot.type === 'work' && (
                      <button 
                        onClick={() => handleUpdateSlot(slot.id, { isRemote: !slot.isRemote })}
                        className={`p-1.5 rounded transition-colors flex items-center justify-center ${
                          slot.isRemote 
                            ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' 
                            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                        }`}
                        title={slot.isRemote ? "Nuotolinis darbas (įjungta)" : "Nuotolinis darbas (išjungta)"}
                      >
                        {slot.isRemote ? <MonitorSmartphone size={14} /> : <Building2 size={14} />}
                      </button>
                    )}

                    {/* Delete */}
                    <button 
                      onClick={() => handleRemoveSlot(slot.id)}
                      className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Ištrinti veiklą"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Slot Details by Type */}
                <div className="w-full pl-5">
                  {/* EXTERNAL WORKPLACE SLOT */}
                  {isExternal ? (
                    <div className="flex flex-col gap-1 w-full bg-teal-100/60 p-1.5 rounded border border-teal-200/80">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-teal-800 uppercase">
                        <Building2 size={12} className="text-teal-600" />
                        <span>Kita darbovietė</span>
                      </div>
                      <input
                        type="text"
                        value={slot.workplaceName || ''}
                        onChange={(e) => handleUpdateSlot(slot.id, { workplaceName: e.target.value })}
                        placeholder="Įstaigos pavadinimas"
                        className="w-full text-xs p-1 bg-white border border-teal-200 rounded text-teal-900 font-medium focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>
                  ) : slot.type === 'work' ? (
                    /* REGULAR WORK / TEACHER LESSON SLOT */
                    <div className="flex flex-col gap-1.5 w-full">
                      {/* Teacher Category Toggle: Pamoka / Lanksčios / Bendra */}
                      {isTeacher && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleUpdateSlot(slot.id, { workCategory: 'lesson' })}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors flex items-center gap-1 ${
                              isLesson ? 'bg-sky-200 text-sky-900 border border-sky-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            <BookOpen size={10} />
                            <span>Pamoka</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateSlot(slot.id, { workCategory: 'flexible' })}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors flex items-center gap-1 ${
                              isFlexible ? 'bg-purple-200 text-purple-900 border border-purple-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                            title="Lanksčios / nekontaktinės valandos (pasiruošimas, metodinė veikla)"
                          >
                            <Sparkles size={10} />
                            <span>Lankstus laikas</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateSlot(slot.id, { workCategory: 'general' })}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                              !isLesson && !isFlexible ? 'bg-gray-300 text-gray-900' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            Kita
                          </button>

                          {isLesson && (
                            <span 
                              className="text-[9px] text-sky-800 bg-sky-100/90 font-bold px-1.5 py-0.5 rounded border border-sky-200 ml-auto whitespace-nowrap" 
                              title="Mokytojui pamokos laikas skaičiuojamas valandomis (1 pamoka = 1 val. norma, nors pati pamoka trunka 45 min.)"
                            >
                              45m → 1 val.
                            </span>
                          )}
                        </div>
                      )}

                      {/* Role Selector */}
                      <div className="relative w-full flex items-center gap-1">
                        <select 
                          value={slot.roleId} 
                          onChange={(e) => handleUpdateSlot(slot.id, { roleId: e.target.value })}
                          className={`w-full text-xs p-1.5 pr-6 bg-transparent border rounded focus:outline-none font-medium appearance-none cursor-pointer ${
                            isOverBudget ? 'text-red-700 border-red-300 bg-red-100/50' : 'text-gray-700 border-gray-200 bg-white focus:border-blue-500'
                          }`}
                        >
                          {roles.map(r => (
                            <option key={r.id} value={r.id}>{r.title}</option>
                          ))}
                        </select>
                        <Briefcase size={12} className={`absolute right-2 top-2 pointer-events-none ${isOverBudget ? 'text-red-400' : 'text-gray-400'}`}/>
                      </div>
                      
                      {/* Remote Badge */}
                      {slot.isRemote && (
                        <div className="flex items-center gap-1.5 text-[10px] text-indigo-600 font-bold px-0.5 animate-fade-in">
                          <MonitorSmartphone size={10} />
                          <span>Nuotolinis</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* BREAK SLOT */
                    <div className="w-full text-center py-1.5 rounded bg-orange-100/60 border border-orange-200">
                      <div className="flex items-center justify-center gap-1 text-xs text-orange-700 font-medium">
                        <Coffee size={12} />
                        <span>Pietų pertrauka ({calculateSlotMinutes(slot.startTime, slot.endTime)} min.)</span>
                      </div>
                      <div className="text-[9px] text-orange-600/80">neįskaičiuojama į darbo laiką</div>
                    </div>
                  )}
                </div>
              </div>

              {showBottomIndicator && (
                <div className="w-full h-1 bg-blue-500 rounded-full mx-auto mt-2 animate-pulse shadow-sm" />
              )}
            </div>
          );
        })}
        
        {day.slots.length === 0 && (
          <div className="text-center py-6 text-gray-400 text-xs border-2 border-dashed border-gray-100 rounded-lg">
            Nėra veiklų
          </div>
        )}

        {/* Action Buttons for Day */}
        <div className="space-y-1.5 pt-1">
          {/* Teacher Fast Action Bar: Add Lesson or Flexible */}
          {isTeacher && (
            <div className="grid grid-cols-2 gap-1.5">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowLessonPicker(!showLessonPicker)}
                  className="w-full py-1.5 px-2 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-lg transition-colors text-xs font-semibold flex items-center justify-center gap-1 shadow-2xs"
                >
                  <BookOpen size={12} />
                  <span>+ Pamoka</span>
                  <ChevronDown size={11} />
                </button>

                {/* Lesson Popover */}
                {showLessonPicker && (
                  <div className="absolute left-0 bottom-full mb-1 w-52 bg-white rounded-lg shadow-lg border border-gray-200 p-1.5 z-30 space-y-1 animate-fade-in">
                    <div className="text-[10px] uppercase font-bold text-gray-400 px-1">Pasirinkite pamoką</div>
                    {STANDARD_LESSON_BELLS.map(bell => (
                      <button
                        key={bell.number}
                        type="button"
                        onClick={() => handleAddLesson(bell.number)}
                        className="w-full text-left px-2 py-1 text-xs rounded hover:bg-sky-50 hover:text-sky-800 text-gray-700 flex justify-between items-center transition-colors font-medium"
                      >
                        <span>{bell.number} pamoka</span>
                        <span className="text-[10px] font-mono text-gray-400">{bell.startTime}-{bell.endTime}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleAddFlexibleHours}
                className="w-full py-1.5 px-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg transition-colors text-xs font-semibold flex items-center justify-center gap-1 shadow-2xs"
                title="Pridėti lanksčias / nekontaktines valandas po pamokų"
              >
                <Sparkles size={12} />
                <span>+ Lanksčios val.</span>
              </button>
            </div>
          )}

          {/* Add regular slot & Add other workplace */}
          <div className="flex gap-1.5">
            <button 
              onClick={() => handleAddSlot('general')}
              className="flex-1 py-1.5 border border-dashed border-gray-300 text-gray-600 rounded-lg hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all text-xs font-medium flex items-center justify-center gap-1"
            >
              <Plus size={13} />
              Pridėti laiką
            </button>

            <button 
              onClick={handleAddExternalSlot}
              className="py-1.5 px-2 bg-teal-50/70 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-lg transition-colors text-xs font-medium flex items-center justify-center gap-1"
              title="Pridėti darbą kitoje darbovietėje (pvz. kitoje mokykloje)"
            >
              <Building2 size={13} className="text-teal-600" />
              <span>+ Kita darbovietė</span>
            </button>
          </div>

          {/* Quick add secondary / smaller roles */}
          {roles.length > 1 && (
            <div className="pt-1 border-t border-gray-100 space-y-1">
              <div className="text-[10px] text-gray-400 font-bold uppercase">Pridėti mažesnių pareigų laiką:</div>
              <div className="flex flex-wrap gap-1">
                {roles.slice(1).map(secRole => (
                  <button
                    key={secRole.id}
                    type="button"
                    onClick={() => handleAddRoleSlot(secRole.id)}
                    className="py-1 px-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-md text-[11px] font-medium flex items-center gap-1 transition-colors"
                    title={`Pridėti ${secRole.title} laiką į ${day.dayName}`}
                  >
                    <Briefcase size={11} className="text-indigo-600" />
                    <span>+ {secRole.title || 'Papildomos pareigos'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
