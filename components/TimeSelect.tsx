
import React from 'react';

const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const minutes = Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, '0'));

interface TimeSelectProps {
  value: string;
  onChange: (val: string) => void;
  className?: string;
  selectClassName?: string;
}

export const TimeSelect: React.FC<TimeSelectProps> = ({ value, onChange, className = "", selectClassName = "" }) => {
  const [rawH, rawM] = (value || "08:00").split(':');
  const h = rawH?.padStart(2, '0') || '08';
  const m = rawM?.padStart(2, '0') || '00';
  
  // Check if current minute is standard; if not, we need to render a custom option
  // This prevents the "invisible time" bug where 13:44 shows as 13:00
  const isCustomMinute = !minutes.includes(m);

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <select 
          value={h} 
          onChange={(e) => onChange(`${e.target.value}:${m}`)}
          className={`bg-gray-50 border border-gray-300 text-gray-900 text-center font-mono appearance-none cursor-pointer hover:bg-gray-100 focus:ring-1 focus:ring-blue-500 outline-none block ${selectClassName}`}
      >
          {hours.map(hour => <option key={hour} value={hour}>{hour}</option>)}
      </select>
      <span className="text-gray-400 font-bold select-none">:</span>
      <select 
          value={m} 
          onChange={(e) => onChange(`${h}:${e.target.value}`)}
          className={`bg-gray-50 border border-gray-300 text-gray-900 text-center font-mono appearance-none cursor-pointer hover:bg-gray-100 focus:ring-1 focus:ring-blue-500 outline-none block ${selectClassName}`}
      >
          {minutes.map(min => <option key={min} value={min}>{min}</option>)}
          {isCustomMinute && <option value={m} className="text-red-600 font-bold">{m}</option>}
      </select>
    </div>
  );
};