import { render } from '@testing-library/react-native';
import { FinishCard } from './FinishCard';

describe('FinishCard', () => {
  it('reports the tallies it was handed, formatted and not recomputed', () => {
    const r = render(<FinishCard blocks={4} setsLogged={9} bestE1rm={112.4} />);
    expect(r.getByTestId('fstat-blocks').props.children).toBe('4');
    expect(r.getByTestId('fstat-sets').props.children).toBe('9');
    expect(r.getByTestId('fstat-e1rm').props.children).toBe('112 kg');
  });

  it('falls back to an em dash for a day with no rated lift', () => {
    const r = render(<FinishCard blocks={2} setsLogged={0} bestE1rm={null} />);
    expect(r.getByTestId('fstat-e1rm').props.children).toBe('—');
  });
});
