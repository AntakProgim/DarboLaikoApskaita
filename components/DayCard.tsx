
import React, { useMemo, useState } from 'react';
import { DaySchedule, DaySlot, JobRole } from '../types';
import { calculateDayNetMinutes, formatDuration, timeToMinutes, minutesToTime, sortSlots, getRoleBreakdown } from '../utils/timeHelper';
import { Briefcase, Coffee, Trash2, Plus, MonitorSmartphone, Building2, GripVertical, History } from 'lucide-react';
import { TimeSelect } from './TimeSelect';

interface DayCardProps {
  day: DaySchedule;
  roles: JobRole[];
  roleUsage: Record<string, number>;
  onChange: (updatedDay: DaySchedule) => void;
}

const MAX_DAILY_MINUTES = 12 * 60;

export const DayCard: React.FC<DayCardProps> = ({ day, roles, roleUsage, onChange }) => {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggedSlotIndex, setDraggedSlotIndex] = useState<number | null>(null);
  const netMinutes = useMemo(() => calculateDayNetMinutes(day.slots), [day.slots]);
  const remainingMinutes = Math.max(0, MAX_DAILY_MINUTES - netMinutes);
  
  // Recalculate breakdown whenever slots change
  const dailyRoleStats = useMemo(() => getRoleBreakdown(day.slots), [day.slots]);

  const handleAddSlot = () => {
    const lastSlot = day.slots[day.slots.length - 1];
    let newStart = "08:00";
    
    if (lastSlot) {
      // Use exact end time of last slot, do not round
      newStart = lastSlot.endTime;
    }

    const newSlot: DaySlot = {
      id: Date.now().toString(),
      startTime: newStart,
      endTime: minutesToTime(timeToMinutes(newStart) + 60), // Default +60min
      type: 'work',
      roleId: roles[0]?.id || '',
      isRemote: false
    };
    
    const newSlots = [...day.slots, newSlot];

    if (calculateDayNetMinutes(newSlots) > MAX_DAILY_MINUTES) {
      alert('Negalima viršyti 12 valandų darbo laiko per dieną.');
      return;
    }

    onChange({ ...day, slots: sortSlots(newSlots) });
  };

  const handleUpdateSlot = (slotId: string, updates: Partial<DaySlot>) => {
    const newSlots = day.slots.map(s => s.id === slotId ? { ...s, ...updates } : s);
    
    if (calculateDayNetMinutes(newSlots) > MAX_DAILY_MINUTES) {
      alert('Negalima viršyti 12 valandų darbo laiko per dieną.');
      return;
    }

    if (updates.startTime) {
        onChange({ ...day, slots: sortSlots(newSlots) });
    } else {
        onChange({ ...day, slots: newSlots });
    }
  };

  const handleRemoveSlot = (slotId: string) => {
    onChange({ ...day, slots: day.slots.filter(s => s.id !== slotId) });
  };

  // Drag and Drop Handlers
  const onDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('slot-index', index.toString());
    e.dataTransfer.effectAllowed = 'move';
    setDraggedSlotIndex(index);
  };

  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault(); // Necessary to allow dropping
    if (dragOverIndex !== index) {
        if (draggedSlotIndex === index) return; // Don't highlight self
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="p-4 pb-3 border-b border-gray-100">
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-xs font-bold uppercase">
                {day.dayName.substring(0, 3)}
            </div>
            <h3 className="font-bold text-gray-800">{day.dayName}</h3>
            </div>
            <div className="text-right">
                <div className={`text-sm font-bold font-mono ${netMinutes > 0 ? 'text-gray-900' : 'text-red-400'}`}>
                    {formatDuration(netMinutes)}
                </div>
                <div className="text-[10px] text-gray-400 font-medium flex items-center justify-end gap-1 mt-0.5" title="Liko iki 12 val. limito">
                   <History size={10} />
                   <span className="opacity-70">Liko:</span>
                   <span className={`${remainingMinutes < 60 ? 'text-amber-500 font-bold' : 'text-gray-600'}`}>
                       {formatDuration(remainingMinutes)}
                   </span>
                </div>
            </div>
          </div>
          
          {/* Role Breakdown Header - Always visible if there is work */}
          {netMinutes > 0 && (
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
            
            // Check global budget (Only standard hours now)
            if (slot.type === 'work' && currentRole) {
                const targetMin = (currentRole.hours * 60) + currentRole.minutes;
                const usedMin = roleUsage[currentRole.id] || 0;
                if (usedMin > targetMin + 5) {
                    isOverBudget = true;
                }
            }

            const isDragged = draggedSlotIndex === index;
            const isDropTarget = dragOverIndex === index && !isDragged;
            
            // Determine where to show visual indicator
            // If dragging downwards (dragIndex < dropIndex), insertion visually happens 'after' (bottom)
            // If dragging upwards (dragIndex > dropIndex), insertion visually happens 'before' (top)
            const showTopIndicator = isDropTarget && draggedSlotIndex !== null && draggedSlotIndex > index;
            const showBottomIndicator = isDropTarget && draggedSlotIndex !== null && draggedSlotIndex < index;

            return (
            <div 
                key={slot.id}
                onDragOver={(e) => onDragOver(e, index)}
                onDrop={(e) => onDrop(e, index)}
                className="transition-all duration-200 ease-in-out"
            >
                {/* Visual Top Indicator */}
                {showTopIndicator && (
                    <div className="w-full h-1 bg-blue-500 rounded-full mx-auto mb-2 animate-pulse shadow-sm" />
                )}

                <div 
                    draggable
                    onDragStart={(e) => onDragStart(e, index)}
                    onDragEnd={onDragEnd}
                    className={`relative group flex flex-col items-start gap-2 p-2 rounded-lg border transition-all ${
                    slot.type === 'break' 
                      ? 'bg-orange-50 border-orange-100' 
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
                                onChange={(v) => handleUpdateSlot(slot.id, { startTime: v })} 
                                selectClassName="w-12 py-1 px-0.5 text-xs rounded border-gray-300 focus:ring-1"
                            />
                            <span className="text-gray-300 text-xs">-</span>
                            <TimeSelect 
                                value={slot.endTime} 
                                onChange={(v) => handleUpdateSlot(slot.id, { endTime: v })} 
                                selectClassName="w-12 py-1 px-0.5 text-xs rounded border-gray-300 focus:ring-1"
                            />
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                            {/* Toggle Type (Work/Break) */}
                            <button 
                                onClick={() => handleUpdateSlot(slot.id, { type: slot.type === 'work' ? 'break' : 'work' })}
                                className={`p-1.5 rounded hover:bg-black/5 transition-colors ${slot.type === 'break' ? 'text-orange-500' : 'text-gray-400'}`}
                                title="Keisti tipą"
                            >
                                {slot.type === 'break' ? <Coffee size={14}/> : <Briefcase size={14}/>}
                            </button>

                            {/* Toggle Remote (Only for work) */}
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
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Role Selector - Full Width */}
                    <div className="w-full pl-5">
                        {slot.type === 'work' ? (
                            <div className="flex flex-col gap-1">
                                <div className="relative w-full flex items-center gap-1">
                                    <select 
                                        value={slot.roleId} 
                                        onChange={(e) => handleUpdateSlot(slot.id, { roleId: e.target.value })}
                                        className={`w-full text-xs p-1.5 pr-6 bg-transparent border rounded focus:outline-none font-medium appearance-none cursor-pointer ${isOverBudget ? 'text-red-700 border-red-300 bg-red-100/50' : 'text-gray-700 border-gray-200 bg-white focus:border-blue-500'}`}
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
                            <div className="w-full text-center py-1.5 rounded bg-orange-100/50 border border-orange-100">
                                <div className="flex items-center justify-center gap-1 text-xs text-orange-600 font-medium">
                                    <Coffee size={12} />
                                    <span>Pertrauka</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Visual Bottom Indicator */}
                {showBottomIndicator && (
                    <div className="w-full h-1 bg-blue-500 rounded-full mx-auto mt-2 animate-pulse shadow-sm" />
                )}
            </div>
        )})}
        
        {day.slots.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-xs border-2 border-dashed border-gray-100 rounded-lg">
                Nėra veiklų
            </div>
        )}

        <button 
            onClick={handleAddSlot}
            className="w-full py-2 border border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all text-xs font-medium flex items-center justify-center gap-1 mt-2"
        >
            <Plus size={14} />
            Pridėti laiką
        </button>
      </div>
    </div>
  );
};
