import { render, screen } from 'util/testing';

import CoachPanel from 'components/chess/CoachPanel';

const noPreview = { show: () => {}, end: () => {}, animate: () => {} };

describe('CoachPanel', () => {
  it('prompts you to move when there is nothing to say yet', () => {
    render(<CoachPanel coach={null} hint={null} grading={false} preview={noPreview} />);

    expect(screen.getByText(/Make a move/i)).toBeInTheDocument();
  });

  it('shows the coach headline and detail once a move has been graded', () => {
    render(
      <CoachPanel
        coach={{
          headline: 'Nxe5 is a blunder; it gives away about 3.0 pawns.',
          detail: ['The problem is d6, which forks the knight and bishop.'],
          highlight: [],
        }}
        hint={null}
        grading={false}
        preview={noPreview}
      />
    );

    expect(screen.getByText(/is a blunder/i)).toBeInTheDocument();
    expect(screen.getByText(/forks the knight and bishop/i)).toBeInTheDocument();
  });

  it('prefers a hint over the coach verdict when one is showing', () => {
    render(
      <CoachPanel
        coach={{ headline: 'coach text', detail: [], highlight: [] }}
        hint={{ headline: 'Think about your knight on f3.', detail: [], highlight: [] }}
        grading={false}
        preview={noPreview}
      />
    );

    expect(screen.getByText(/Think about your knight/i)).toBeInTheDocument();
    expect(screen.queryByText(/coach text/i)).not.toBeInTheDocument();
  });
});
