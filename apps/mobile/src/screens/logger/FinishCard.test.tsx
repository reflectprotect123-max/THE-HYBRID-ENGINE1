import { render } from '@testing-library/react-native';
import { FinishCard } from './FinishCard';

describe('FinishCard', () => {
  it('reports the tallies it was handed, formatted and not recomputed', () => {
    const r = render(<FinishCard blocks={4} setsLogged={9} bestE1rm={112.4} seconds={3930} />);
    expect(r.getByTestId('fstat-blocks').props.children).toBe('4');
    expect(r.getByTestId('fstat-sets').props.children).toBe('9');
    expect(r.getByTestId('fstat-e1rm').props.children).toBe('112 kg');
    expect(r.getByTestId('fstat-time').props.children).toBe('1:05:30');
  });

  it('em-dashes the time rather than claiming a 0:00 session', () => {
    /* A session with no `completedAt` yet — the recap applies the same rule,
       and "0:00" would read as a session that took no time rather than as one
       whose length is not known. */
    const r = render(<FinishCard blocks={2} setsLogged={0} bestE1rm={null} seconds={0} />);
    expect(r.getByTestId('fstat-time').props.children).toBe('—');
  });

  it('falls back to an em dash for a day with no rated lift', () => {
    const r = render(<FinishCard blocks={2} setsLogged={0} bestE1rm={null} seconds={0} />);
    expect(r.getByTestId('fstat-e1rm').props.children).toBe('—');
  });
});
