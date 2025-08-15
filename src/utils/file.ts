import fs from 'fs';

export const saveStringToFile = (filePath: string, content: string) => {
  fs.writeFileSync(filePath, content);
};
