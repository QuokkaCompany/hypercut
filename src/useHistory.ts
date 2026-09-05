import { useReducer } from 'react';
export function useHistory<T>(initial: T) {
  const [state, dispatch] = useReducer((state: { past: T[]; value: T; future: T[] }, action: { type: 'load' | 'edit'; value: T } | { type: 'undo' | 'redo' }) => {
    if (action.type === 'load') return { past: [], value: action.value, future: [] };
    if (action.type === 'edit') return { past: [...state.past.slice(-49), state.value], value: action.value, future: [] };
    if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0, -1), value: state.past.at(-1)!, future: [state.value, ...state.future] };
    if (action.type === 'redo' && state.future.length) return { past: [...state.past, state.value], value: state.future[0], future: state.future.slice(1) };
    return state;
  }, { past: [], value: initial, future: [] });
  return { value: state.value, canUndo: !!state.past.length, canRedo: !!state.future.length, edit: (value: T) => dispatch({ type: 'edit', value }), load: (value: T) => dispatch({ type: 'load', value }), undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }) };
}
