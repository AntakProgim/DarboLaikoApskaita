import React from 'react';
import { WeekdayLessons } from '../types';
import { STANDARD_LESSON_BELLS } from '../utils/timeHelper';
import { BookOpen, Check, Trash2, Calendar, Sparkles } from 'lucide-react';

interface WeeklyLessonGridProps {
  value: WeekdayLessons;
  onChange: (newVal: WeekdayLessons) => void;
  primaryRoleTitle?: string;
}

const WEEKDAYS = [
  { offset: 0, short: 'Pr', full: 'Pirmadienis' },
  { offset: 1, short: 'An', full: 'Antradienis' },
  { offset: 2, short: 'Tr', full: 'Trečiadienis' },
  { offset: 3, short: 'Kt', full: 'Ketvirtadienis' },
  { offset: 4, short: 'Pn', full: 'Penktadienis' },
];

export const WeeklyLessonGrid: React.FC<WeeklyLessonGridProps> = ({ 
  value = {}, 
  onChange,
  primaryRoleTitle = 'Pagrindinės pareigos'
}) => {
  const toggleLesson = (dayOffset: number, lessonNumber: number) => {
    const currentDayLessons = value[dayOffset] || [];
    const isSelected = currentDayLessons.includes(lessonNumber);
    
    let updatedDayLessons: number[];
    if (isSelected) {
      updatedDayLessons = currentDayLessons.filter(n => n !== lessonNumber);
    } else {
      updatedDayLessons = [...currentDayLessons, lessonNumber].sort((a, b) => a - b);
    }

    onChange({
      ...value,
      [dayOffset]: updatedDayLessons
    });
  };

  const handleSetPreset = (preset: 'standard4' | 'standard5' | 'clear') => {
    if (preset === 'clear') {
      onChange({ 0: [], 1: [], 2: [], 3: [], 4: [] });
      return;
    }

    const newLessons: WeekdayLessons = {};
    WEEKDAYS.forEach(day => {
      if (preset === 'standard4') {
        newLessons[day.offset] = [1, 2, 3, 4];
      } else if (preset === 'standard5') {
        newLessons[day.offset] = day.offset === 4 ? [1, 2, 3, 4] : [1, 2, 3, 4, 5];
      }
    });
    onChange(newLessons);
  };

  // Calculate total lessons and total minutes (1 pamoka = 1 val. = 60 min. darbo laiko apskaitoje)
  const totalLessonsCount = (Object.values(value) as number[][]).reduce((sum: number, list: number[]) => sum + (list ? list.length : 0), 0);
  const totalHours = totalLessonsCount; // 1 pamoka = 1 val.

  return (
    <div className="bg-white rounded-xl border border-sky-200 p-4 space-y-3 shadow-xs">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 border-b border-sky-100 pb-2.5">
        <div>
          <div className="text-xs font-bold text-sky-950 flex items-center gap-1.5 uppercase tracking-wide">
            <BookOpen size={14} className="text-blue-600" />
            <span>Pamokų / Užsiėmimų tvarkaraštis savaitės dienomis</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Pažymėkite pamokų laikus dienomis ({primaryRoleTitle}). Kitos pareigos ir lanksčios valandos bus dėliojamos ne pamokų metu.
          </p>
        </div>

        {/* Quick presets */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleSetPreset('standard4')}
            className="px-2 py-1 text-[10px] bg-sky-50 hover:bg-sky-100 text-sky-700 font-medium rounded border border-sky-200 transition-colors"
          >
            1-4 pam. kasdien
          </button>
          <button
            type="button"
            onClick={() => handleSetPreset('standard5')}
            className="px-2 py-1 text-[10px] bg-sky-50 hover:bg-sky-100 text-sky-700 font-medium rounded border border-sky-200 transition-colors"
          >
            1-5 pam.
          </button>
          <button
            type="button"
            onClick={() => handleSetPreset('clear')}
            className={`px-2 py-1 text-[10px] font-medium rounded border transition-colors flex items-center gap-1 ${
              totalLessonsCount === 0 
                ? 'bg-red-50 text-red-700 border-red-300 font-bold' 
                : 'text-gray-500 hover:text-red-600 bg-gray-50 hover:bg-red-50 border-gray-200'
            }`}
            title="Išvalyti pamokas (visos dienos be pamokų)"
          >
            <Trash2 size={11} />
            <span>Išvalyti</span>
          </button>
        </div>
      </div>

      {totalLessonsCount === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-[11px] p-2 rounded-lg flex items-center gap-1.5 animate-fade-in font-medium">
          <span>ℹ️ Pamokų tvarkaraštis išvalytas (0 kontaktinių pamokų). Darbo laikas prasidės nuo 08:00 (ar jūsų nustatytos pradžios) ir bus pilnai suplanuotas pagal pasirinktą normą (7,12 val. ar 8 val.).</span>
        </div>
      )}

      {/* Timetable Matrix */}
      <div className="overflow-x-auto pb-1">
        <table className="w-full text-xs border-collapse text-center">
          <thead>
            <tr className="bg-sky-50/70 border-b border-sky-100">
              <th className="py-2 px-2 text-left text-[11px] font-bold text-gray-600 w-28">Pamoka / Laikas</th>
              {WEEKDAYS.map(day => {
                const dayCount = (value[day.offset] || []).length;
                return (
                  <th key={day.offset} className="py-2 px-1 text-center font-bold text-gray-700">
                    <div>{day.short}</div>
                    <div className="text-[9px] font-normal text-sky-600">{dayCount > 0 ? `${dayCount} pam.` : '-'}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {STANDARD_LESSON_BELLS.map(bell => (
              <tr key={bell.number} className="hover:bg-sky-50/30 transition-colors">
                <td className="py-1 px-2 text-left font-medium text-gray-700 whitespace-nowrap">
                  <div className="font-semibold text-gray-800">{bell.number} pamoka</div>
                  <div className="text-[10px] text-gray-400 font-mono">{bell.startTime} - {bell.endTime}</div>
                </td>
                {WEEKDAYS.map(day => {
                  const dayLessons = value[day.offset] || [];
                  const isChecked = dayLessons.includes(bell.number);
                  return (
                    <td key={day.offset} className="py-1 px-1">
                      <button
                        type="button"
                        onClick={() => toggleLesson(day.offset, bell.number)}
                        className={`w-full py-1.5 px-1 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1 ${
                          isChecked 
                            ? 'bg-blue-600 text-white shadow-2xs hover:bg-blue-700' 
                            : 'bg-gray-50 text-gray-400 hover:bg-sky-100/60 hover:text-sky-800 border border-gray-200/60'
                        }`}
                        title={`${day.full}, ${bell.number} pamoka (${bell.startTime}-${bell.endTime})`}
                      >
                        {isChecked ? <Check size={12} strokeWidth={3} /> : <span className="opacity-40">{bell.number}</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-sky-100 text-xs">
        <div className="text-gray-700">
          Iš viso pamokų tvarkaraštyje: <b className="text-blue-700">{totalLessonsCount}</b> (<b className="text-blue-700">{totalHours} val.</b> darbo laiko apskaitoje)
          <span className="text-[11px] text-gray-500 ml-1.5">(1 pamoka = 1 val. norma, nors trunka 45 min.)</span>
        </div>
        <div className="text-[11px] text-sky-700 font-medium flex items-center gap-1">
          <Sparkles size={12} />
          <span>Lanksčios valandos ir kitos pareigos bus dėliojamos po pamokų</span>
        </div>
      </div>
    </div>
  );
};
