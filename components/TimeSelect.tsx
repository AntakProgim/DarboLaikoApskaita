
import React, { useState, useEffect } from 'react';

const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));

interface TimeSelectProps {
  value: string;
  onChange: (val: string) => void;
  className?: string;
  selectClassName?: string;
}

export const TimeSelect: React.FC<TimeSelectProps> = ({ value, onChange, className = "", selectClassName = "" }) => {
  const [rawH, rawM] = (value || "08:00").split(':');
  
  // Local state for minute input to allow typing without immediate jarring updates or validation blocking
  const [minuteInput, setMinuteInput] = useState(rawM || '00');

  useEffect(() => {
    setMinuteInput(rawM || '00');
  }, [rawM]);

  const handleHourChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(`${e.target.value}:${rawM}`);
  };

  const handleMinuteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    // Allow empty string for better typing experience, validate later
    if (val.length > 2) val = val.slice(0, 2);
    setMinuteInput(val);
    
    // Trigger update immediately if valid number, so totals update in real-time
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 0 && num < 60) {
        onChange(`${rawH}:${val.padStart(2, '0')}`);
    }
  };

  const handleMinuteBlur = () => {
    let num = parseInt(minuteInput, 10);
    if (isNaN(num)) num = 0;
    if (num < 0) num = 0;
    if (num > 59) num = 59;
    
    const formatted = num.toString().padStart(2, '0');
    setMinuteInput(formatted);
    onChange(`${rawH}:${formatted}`);
  };

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <select 
          value={rawH} 
          onChange={handleHourChange}
          className={`bg-gray-50 border border-gray-300 text-gray-900 text-center font-mono appearance-none cursor-pointer hover:bg-gray-100 focus:ring-1 focus:ring-blue-500 outline-none block ${selectClassName}`}
      >
          {hours.map(hour => <option key={hour} value={hour}>{hour}</option>)}
      </select>
      <span className="text-gray-400 font-bold select-none">:</span>
      <input
          type="number"
          min="0"
          max="59"
          value={minuteInput}
          onChange={handleMinuteChange}
          onBlur={handleMinuteBlur}
          className={`bg-gray-50 border border-gray-300 text-gray-900 text-center font-mono hover:bg-gray-100 focus:ring-1 focus:ring-blue-500 outline-none block ${selectClassName}`}
          style={{ width: '3rem' }} // Fixed width for consistency
      />
    </div>
  );
};
