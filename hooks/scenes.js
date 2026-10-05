// Griglia 12 x 8, ogni cella è larga 3 caratteri.
export const W = 12
export const H = 8

// slots = posizioni disponibili per le postazioni, nell'ordine in cui vengono aggiunte.
// deco = oggetti fissi di arredo.
export const SCENES = {
  bridge: {
    label: 'Plancia',
    floor: ' · ',
    deskGlyph: '[=]',
    deskColor: 'yellow',
    stationName: 'Console',
    slots: [[2, 3], [5, 3], [8, 3], [2, 6], [5, 6], [8, 6]],
    deco: [
      { x: 0, y: 0, g: '|||', color: 'blue' },
      { x: 11, y: 0, g: '(f)', color: 'green' },
      { x: 6, y: 0, g: '[W]', color: 'cyan' },
    ],
  },
  engine: {
    label: 'Sala macchine',
    floor: ' ~ ',
    deskGlyph: '[T]',
    deskColor: 'red',
    stationName: 'Banco ingegneria',
    slots: [[1, 3], [4, 3], [7, 3], [10, 3], [3, 6], [8, 6]],
    deco: [
      { x: 0, y: 0, g: '=^=', color: 'red' },
      { x: 5, y: 1, g: '<O>', color: 'white' },
      { x: 11, y: 7, g: '{#}', color: 'yellow' },
    ],
  },
  habitat: {
    label: 'Serra',
    floor: ' + ',
    deskGlyph: '[#]',
    deskColor: 'cyan',
    stationName: 'Postazione scanner',
    slots: [[2, 2], [5, 2], [8, 2], [2, 5], [5, 5], [8, 5]],
    deco: [
      { x: 0, y: 7, g: '%%%', color: 'magenta' },
      { x: 11, y: 0, g: '~o~', color: 'green' },
    ],
  },
}

export const SCENE_IDS = Object.keys(SCENES)
