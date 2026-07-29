import { createFileRoute } from '@tanstack/react-router';
import Trainer from 'components/pages/Trainer';

export const Route = createFileRoute('/')({
  component: Trainer,
});
