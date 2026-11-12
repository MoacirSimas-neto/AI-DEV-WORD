import type { MissionInfo, MissionPhase } from './protocol.ts'

/** Fases em que uma missão ainda está em andamento (clássica ou dinâmica). */
export const OPEN_PHASES: MissionPhase[] = ['planning', 'awaiting_approval', 'awaiting_clarification', 'developing', 'reviewing', 'executing', 'awaiting_decision']

export const isOpenMission = (mission: Pick<MissionInfo, 'phase'>) => OPEN_PHASES.includes(mission.phase)
