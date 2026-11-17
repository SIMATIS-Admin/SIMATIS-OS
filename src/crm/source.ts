// Records copied from the compatible CRM (connector `crm-os`). That CRM is the reference: for now the
// OS only mirrors it, so a mirrored record is not edited here (the next sync would undo the edit).
export const SOURCE_CRM_OS = 'crm-os';

export const copieEnLectureSeule = (source: string): boolean => source === SOURCE_CRM_OS;

export const MESSAGE_LECTURE_SEULE =
  'Fiche reprise du CRM compatible, en lecture seule : modifiez-la dans ce CRM, elle remontera à la prochaine synchronisation.';
