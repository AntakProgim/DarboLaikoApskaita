import { DaySchedule, WorkConfig } from '../types';

export const exportToCSV = (schedule: DaySchedule[], config: WorkConfig) => {
  // Columns requested: Day, Start Time, End Time, Type, Role, Remote status
  const headers = ["Diena", "Pradžia", "Pabaiga", "Tipas", "Pareigos", "Nuotolinis"];
  const rows = [headers.join(",")];

  schedule.forEach(day => {
      day.slots.forEach(slot => {
          const role = config.roles.find(r => r.id === slot.roleId);
          const roleName = slot.type === 'work' ? (role?.title || 'Nenurodyta') : '-';
          const typeName = slot.type === 'work' ? 'Darbas' : 'Pertrauka';
          const remote = slot.isRemote ? 'Taip' : 'Ne';

          // CSV escaping
          const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;

          rows.push([
              escape(day.dayName),
              escape(slot.startTime),
              escape(slot.endTime),
              escape(typeName),
              escape(roleName),
              escape(remote)
          ].join(","));
      });
  });

  const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${config.fullName.replace(/\s+/g, '_')}_Grafikas.csv`;
  link.click();
  URL.revokeObjectURL(url);
};