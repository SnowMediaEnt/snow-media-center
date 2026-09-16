import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Brain,
  Check,
  Film,
  Flame,
  FlaskConical,
  Globe2,
  Leaf,
  Music2,
  RotateCcw,
  Snowflake,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/button';
import { GameShell } from './shared/GameUI';
import { isGlobalModalOpen, visualArrowDir } from './shared/gameInput';
import { useGameBack } from './shared/gameBack';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useGameAudio } from './shared/gameAudio';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useAuth } from '@/hooks/useAuth';
import { useGameSocket } from '@/hooks/useGameSocket';
import { gameSocket } from '@/lib/gameSocket';
import {
  loadSnowTriviaQuestions,
  SNOW_MEDIA_TRIVIA_FALLBACK,
  type SnowTriviaTopic,
  type TriviaCategory,
  type TriviaQuestion,
} from '@/lib/triviaQuestions';
import '@/styles/games-trivia.css';

interface TVTriviaProps {
  onBack: () => void;
}

export type { TriviaQuestion } from '@/lib/triviaQuestions';
export type TriviaMode = 'snow' | 'mixed';
type TriviaDifficulty = 'easy' | 'standard' | 'expert';

/**
 * Bundled, family-friendly questions keep TV Trivia instant and fully offline.
 * The bank is exported so future content additions can be validated without
 * exposing the correct answer anywhere in the rendered game.
 */
// Exported only so the focused content tests can verify answers without
// leaking correctness into rendered attributes.
// eslint-disable-next-line react-refresh/only-export-components
export const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  ...SNOW_MEDIA_TRIVIA_FALLBACK,
  {
    id: 'science-red-planet', category: 'science', categoryLabel: 'Science Lab',
    prompt: 'Which planet is known as the Red Planet?',
    answers: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: 1,
    fact: 'Iron minerals in Martian soil oxidize, giving Mars its rusty red color.',
  },
  {
    id: 'science-freezing', category: 'science', categoryLabel: 'Science Lab',
    prompt: 'At what temperature does fresh water freeze on the Celsius scale?',
    answers: ['0°', '10°', '32°', '100°'], correct: 0,
    fact: 'At standard atmospheric pressure, fresh water freezes at 0 degrees Celsius.',
  },
  {
    id: 'science-plants', category: 'science', categoryLabel: 'Science Lab',
    prompt: 'Which gas do plants absorb from the air during photosynthesis?',
    answers: ['Oxygen', 'Helium', 'Carbon dioxide', 'Hydrogen'], correct: 2,
    fact: 'Plants use carbon dioxide, water, and light energy to make sugars and oxygen.',
  },
  {
    id: 'science-organ', category: 'science', categoryLabel: 'Science Lab',
    prompt: 'What is the largest organ of the human body?',
    answers: ['The heart', 'The skin', 'The lungs', 'The liver'], correct: 1,
    fact: 'The skin is the body’s largest organ and its first protective barrier.',
  },
  {
    id: 'science-sound', category: 'science', categoryLabel: 'Science Lab',
    prompt: 'Where can sound not travel?',
    answers: ['Through water', 'Through steel', 'Through air', 'Through a vacuum'], correct: 3,
    fact: 'Sound needs matter to carry its vibrations, so it cannot cross a true vacuum.',
  },
  {
    id: 'screen-toy-story', category: 'screen', categoryLabel: 'Movies & TV',
    prompt: 'What is the name of the cowboy toy in Toy Story?',
    answers: ['Buzz', 'Woody', 'Rex', 'Slinky'], correct: 1,
    fact: 'Sheriff Woody is Andy’s pull-string cowboy doll and longtime favorite toy.',
  },
  {
    id: 'screen-frozen', category: 'screen', categoryLabel: 'Movies & TV',
    prompt: 'Which character is the snow queen in Frozen?',
    answers: ['Anna', 'Moana', 'Elsa', 'Ariel'], correct: 2,
    fact: 'Elsa has the magical ability to create and control ice and snow.',
  },
  {
    id: 'screen-wakanda', category: 'screen', categoryLabel: 'Movies & TV',
    prompt: 'Which superhero is the protector of Wakanda?',
    answers: ['Black Panther', 'Spider-Man', 'Thor', 'Ant-Man'], correct: 0,
    fact: 'Black Panther is the heroic title carried by Wakanda’s chosen protector.',
  },
  {
    id: 'screen-hobbit', category: 'screen', categoryLabel: 'Movies & TV',
    prompt: 'Which hobbit joins a quest to reclaim the Lonely Mountain?',
    answers: ['Samwise Gamgee', 'Pippin Took', 'Bilbo Baggins', 'Frodo Baggins'], correct: 2,
    fact: 'Bilbo Baggins leaves the Shire with Thorin’s company in The Hobbit.',
  },
  {
    id: 'screen-simpsons', category: 'screen', categoryLabel: 'Movies & TV',
    prompt: 'In which town does The Simpsons family live?',
    answers: ['South Park', 'Springfield', 'Bedrock', 'Hill Valley'], correct: 1,
    fact: 'The Simpsons live at 742 Evergreen Terrace in the fictional town of Springfield.',
  },
  {
    id: 'world-pyramids', category: 'world', categoryLabel: 'Around the World',
    prompt: 'The pyramids of Giza are located in which country?',
    answers: ['Mexico', 'Greece', 'Egypt', 'India'], correct: 2,
    fact: 'The Giza pyramid complex sits just outside Cairo, Egypt.',
  },
  {
    id: 'world-tokyo', category: 'world', categoryLabel: 'Around the World',
    prompt: 'Tokyo is the capital city of which country?',
    answers: ['Japan', 'Thailand', 'South Korea', 'Vietnam'], correct: 0,
    fact: 'Tokyo is Japan’s capital and the center of its largest metropolitan area.',
  },
  {
    id: 'world-ocean', category: 'world', categoryLabel: 'Around the World',
    prompt: 'What is the largest ocean on Earth?',
    answers: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3,
    fact: 'The Pacific Ocean covers more area than all of Earth’s land combined.',
  },
  {
    id: 'world-brazil', category: 'world', categoryLabel: 'Around the World',
    prompt: 'What is the official language of Brazil?',
    answers: ['Spanish', 'Portuguese', 'French', 'Italian'], correct: 1,
    fact: 'Brazil is the largest Portuguese-speaking country in the world.',
  },
  {
    id: 'world-eiffel', category: 'world', categoryLabel: 'Around the World',
    prompt: 'In which city would you find the Eiffel Tower?',
    answers: ['Rome', 'London', 'Paris', 'Madrid'], correct: 2,
    fact: 'The Eiffel Tower was completed in Paris for the 1889 World’s Fair.',
  },
  {
    id: 'music-piano', category: 'music', categoryLabel: 'Music Mix',
    prompt: 'How many keys are on a standard modern piano?',
    answers: ['66', '72', '88', '100'], correct: 2,
    fact: 'A standard piano has 52 white keys and 36 black keys, for 88 total.',
  },
  {
    id: 'music-conductor', category: 'music', categoryLabel: 'Music Mix',
    prompt: 'Who guides an orchestra during a performance?',
    answers: ['A conductor', 'A producer', 'A referee', 'A curator'], correct: 0,
    fact: 'A conductor coordinates tempo, timing, balance, and expression across the orchestra.',
  },
  {
    id: 'music-tempo', category: 'music', categoryLabel: 'Music Mix',
    prompt: 'What does tempo describe in music?',
    answers: ['The volume', 'The speed', 'The lyrics', 'The instrument'], correct: 1,
    fact: 'Tempo tells musicians how fast or slowly a piece should be performed.',
  },
  {
    id: 'music-brass', category: 'music', categoryLabel: 'Music Mix',
    prompt: 'Which of these belongs to the brass family?',
    answers: ['Violin', 'Flute', 'Trumpet', 'Xylophone'], correct: 2,
    fact: 'A trumpet produces sound from vibrating lips through a brass mouthpiece.',
  },
  {
    id: 'music-strings', category: 'music', categoryLabel: 'Music Mix',
    prompt: 'How many strings does a standard violin have?',
    answers: ['Four', 'Five', 'Six', 'Eight'], correct: 0,
    fact: 'A standard violin has four strings tuned to G, D, A, and E.',
  },
  {
    id: 'sports-basketball', category: 'sports', categoryLabel: 'Sports & Games',
    prompt: 'How many players from one team are on a basketball court at once?',
    answers: ['Four', 'Five', 'Six', 'Seven'], correct: 1,
    fact: 'Each basketball team fields five players on the court at a time.',
  },
  {
    id: 'sports-tennis', category: 'sports', categoryLabel: 'Sports & Games',
    prompt: 'In tennis scoring, what does “love” mean?',
    answers: ['A tie', 'Advantage', 'Zero', 'Match point'], correct: 2,
    fact: 'In tennis, “love” is the traditional term for a score of zero.',
  },
  {
    id: 'sports-goalkeeper', category: 'sports', categoryLabel: 'Sports & Games',
    prompt: 'Which soccer player may use their hands inside the penalty area?',
    answers: ['The captain', 'The striker', 'The goalkeeper', 'Any defender'], correct: 2,
    fact: 'The goalkeeper may handle the ball inside their own penalty area.',
  },
  {
    id: 'sports-olympics', category: 'sports', categoryLabel: 'Sports & Games',
    prompt: 'How many rings appear on the Olympic symbol?',
    answers: ['Four', 'Five', 'Six', 'Seven'], correct: 1,
    fact: 'The five interlocking Olympic rings represent the union of five inhabited continents.',
  },
  {
    id: 'sports-chess', category: 'sports', categoryLabel: 'Sports & Games',
    prompt: 'What position ends a game of chess with a winner?',
    answers: ['Checkmate', 'Touchdown', 'Home run', 'Deuce'], correct: 0,
    fact: 'Checkmate means the king is threatened and has no legal way to escape.',
  },
  {
    id: 'nature-bats', category: 'nature', categoryLabel: 'Wild Nature',
    prompt: 'Which mammal is capable of true sustained flight?',
    answers: ['Flying squirrel', 'Sugar glider', 'Bat', 'Penguin'], correct: 2,
    fact: 'Bats are the only mammals that can power and sustain true flight.',
  },
  {
    id: 'nature-whale', category: 'nature', categoryLabel: 'Wild Nature',
    prompt: 'What is the largest animal known to have lived on Earth?',
    answers: ['African elephant', 'Blue whale', 'Giraffe', 'Great white shark'], correct: 1,
    fact: 'A blue whale can grow beyond 30 meters and weigh well over 100 tons.',
  },
  {
    id: 'nature-frog', category: 'nature', categoryLabel: 'Wild Nature',
    prompt: 'What is a young frog called before it grows legs?',
    answers: ['A tadpole', 'A calf', 'A chick', 'A cub'], correct: 0,
    fact: 'A tadpole begins life in water and transforms through metamorphosis.',
  },
  {
    id: 'nature-bees', category: 'nature', categoryLabel: 'Wild Nature',
    prompt: 'What is the home of a honeybee colony called?',
    answers: ['A den', 'A lodge', 'A hive', 'A burrow'], correct: 2,
    fact: 'Honeybees live together in colonies housed in nests commonly called hives.',
  },
  {
    id: 'nature-cheetah', category: 'nature', categoryLabel: 'Wild Nature',
    prompt: 'Which animal is the fastest runner on land?',
    answers: ['Lion', 'Horse', 'Ostrich', 'Cheetah'], correct: 3,
    fact: 'A cheetah can accelerate rapidly and sprint at highway speeds for short bursts.',
  },
];

export const TRIVIA_SESSION_LENGTH = 10;
const ANSWER_LETTERS = ['A', 'B', 'C', 'D'];
const CATEGORIES: TriviaCategory[] = ['snow', 'science', 'screen', 'world', 'music', 'sports', 'nature'];
const SNOW_TOPICS: SnowTriviaTopic[] = ['devices', 'service', 'app', 'history'];
const MODE_STORAGE_KEY = 'smc-tv-trivia-mode-v1';
const DIFFICULTY_STORAGE_KEY = 'smc-tv-trivia-difficulty-v1';
const DIFFICULTIES: TriviaDifficulty[] = ['easy', 'standard', 'expert'];
const DIFFICULTY_BET: Record<TriviaDifficulty, number> = { easy: 10, standard: 25, expert: 50 };
const DIFFICULTY_POINTS: Record<TriviaDifficulty, number> = { easy: 1, standard: 1.5, expert: 2 };

const shuffled = <T,>(items: T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const hold = result[i];
    result[i] = result[j];
    result[j] = hold;
  }
  return result;
};

/** Mixed sessions include every category; Snow sessions stay on-brand. */
// eslint-disable-next-line react-refresh/only-export-components
export const createTriviaSession = (
  bank: TriviaQuestion[] = TRIVIA_QUESTIONS,
  mode: TriviaMode = 'mixed',
): TriviaQuestion[] => {
  const available = mode === 'snow'
    ? bank.filter((question) => question.category === 'snow')
    : bank.filter((question) => question.category !== 'snow');
  if (available.length === 0) return [];
  if (mode === 'snow') {
    const topicPass = SNOW_TOPICS
      .map((topic) => {
        const choices = available.filter((question) => question.topic === topic);
        return choices.length > 0 ? choices[Math.floor(Math.random() * choices.length)] : null;
      })
      .filter((question): question is TriviaQuestion => question !== null);
    const picked = new Set(topicPass.map((question) => question.id));
    const remaining = shuffled(available.filter((question) => !picked.has(question.id)));
    return shuffled([...topicPass, ...remaining.slice(0, TRIVIA_SESSION_LENGTH - topicPass.length)]);
  }

  const availableCategories = CATEGORIES.filter((category) => available.some((question) => question.category === category));
  const firstPass = availableCategories.map((category) => {
    const choices = available.filter((question) => question.category === category);
    return choices[Math.floor(Math.random() * choices.length)];
  });
  const picked = new Set(firstPass.map((question) => question.id));
  const remaining = shuffled(available.filter((question) => !picked.has(question.id)));
  return shuffled([...firstPass, ...remaining.slice(0, TRIVIA_SESSION_LENGTH - firstPass.length)]);
};

const CategoryIcon = ({ category }: { category: TriviaCategory }) => {
  if (category === 'snow') return <Snowflake />;
  if (category === 'science') return <FlaskConical />;
  if (category === 'screen') return <Film />;
  if (category === 'world') return <Globe2 />;
  if (category === 'music') return <Music2 />;
  if (category === 'nature') return <Leaf />;
  return <Trophy />;
};

type FocusZone = 'back' | 'mode' | 'difficulty' | 'audio' | 'fx' | 'answer' | 'next';

const initialTriviaMode = (): TriviaMode => {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'mixed' ? 'mixed' : 'snow';
  } catch {
    return 'snow';
  }
};

const initialDifficulty = (): TriviaDifficulty => {
  try {
    const value = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    return DIFFICULTIES.includes(value as TriviaDifficulty) ? value as TriviaDifficulty : 'standard';
  } catch { return 'standard'; }
};

const generalTriviaQuestions = TRIVIA_QUESTIONS.filter((question) => question.category !== 'snow');

const TVTrivia = ({ onBack }: TVTriviaProps) => {
  const { user } = useAuth();
  const { balance } = useGameSocket();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const { muted, play: playSound, toggleMuted } = useGameAudio();
  const [mode, setMode] = useState<TriviaMode>(initialTriviaMode);
  const [difficulty, setDifficulty] = useState<TriviaDifficulty>(initialDifficulty);
  const [questionBank, setQuestionBank] = useState<TriviaQuestion[]>(TRIVIA_QUESTIONS);
  const [questions, setQuestions] = useState<TriviaQuestion[]>(() => createTriviaSession(TRIVIA_QUESTIONS, initialTriviaMode()));
  const [contentSource, setContentSource] = useState<'network' | 'cache' | 'bundled'>('bundled');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [finished, setFinished] = useState(false);
  const [focusZone, setFocusZone] = useState<FocusZone>('answer');
  const [answerIndex, setAnswerIndex] = useState(0);
  const [coinPayout, setCoinPayout] = useState<number | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  const backRef = useRef<HTMLButtonElement>(null);
  const modeRef = useRef<HTMLButtonElement>(null);
  const difficultyRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLButtonElement>(null);
  const answerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextRef = useRef<HTMLButtonElement>(null);
  const modeValueRef = useRef(mode);
  const sessionTouchedRef = useRef(false);
  const completionCuePlayedRef = useRef(false);
  const settlementSentRef = useRef(false);

  useTvActivate(activateFocused);
  const { requestBack } = useGameBack({ onExit: onBack });

  const question = questions[questionIndex];
  const answeredCorrectly = selectedAnswer === question?.correct;
  const progress = finished ? 100 : ((questionIndex + 1) / questions.length) * 100;

  useEffect(() => {
    modeValueRef.current = mode;
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    void loadSnowTriviaQuestions().then((result) => {
      if (cancelled) return;
      const nextBank = [...result.questions, ...generalTriviaQuestions];
      setQuestionBank(nextBank);
      setContentSource(result.source);
      // Fresh published content may replace the untouched opening question,
      // but it never changes a round after the viewer has started answering.
      if (!sessionTouchedRef.current) {
        setQuestions(createTriviaSession(nextBank, modeValueRef.current));
        setQuestionIndex(0);
        setSelectedAnswer(null);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (focusZone === 'back') backRef.current?.focus();
    else if (focusZone === 'mode') modeRef.current?.focus();
    else if (focusZone === 'difficulty') difficultyRef.current?.focus();
    else if (focusZone === 'audio') audioRef.current?.focus();
    else if (focusZone === 'fx') fxRef.current?.focus();
    else if (focusZone === 'answer') answerRefs.current[answerIndex]?.focus();
    else nextRef.current?.focus();
  }, [focusZone, answerIndex, questionIndex, selectedAnswer, finished]);

  const answerQuestion = useCallback((index: number) => {
    if (selectedAnswer !== null || finished) return;
    sessionTouchedRef.current = true;
    const isCorrect = index === question.correct;
    const nextStreak = isCorrect ? streak + 1 : 0;
    const basePoints = Math.round((question.points ?? 100) * DIFFICULTY_POINTS[difficulty]);
    setSelectedAnswer(index);
    if (isCorrect) {
      setCorrectCount((count) => count + 1);
      setScore((points) => points + basePoints + streak * 25);
      setStreak(nextStreak);
      setBestStreak((best) => Math.max(best, nextStreak));
    } else {
      setStreak(0);
    }
    playSound(isCorrect ? 'triviaCorrect' : 'triviaWrong');
    setFocusZone('next');
  }, [difficulty, finished, playSound, question, selectedAnswer, streak]);

  const advance = useCallback(() => {
    if (selectedAnswer === null) return;
    if (questionIndex >= questions.length - 1) {
      setFinished(true);
      setFocusZone('next');
      return;
    }
    setQuestionIndex((index) => index + 1);
    setSelectedAnswer(null);
    setAnswerIndex(0);
    setFocusZone('answer');
  }, [questionIndex, questions.length, selectedAnswer]);

  const resetRound = useCallback((nextMode: TriviaMode) => {
    sessionTouchedRef.current = false;
    completionCuePlayedRef.current = false;
    settlementSentRef.current = false;
    setQuestions(createTriviaSession(questionBank, nextMode));
    setQuestionIndex(0);
    setSelectedAnswer(null);
    setScore(0);
    setCorrectCount(0);
    setStreak(0);
    setBestStreak(0);
    setFinished(false);
    setCoinPayout(null);
    setSettleError(null);
    setAnswerIndex(0);
    setFocusZone('answer');
  }, [questionBank]);

  const playAgain = useCallback(() => {
    resetRound(mode);
  }, [mode, resetRound]);

  useEffect(() => {
    if (!finished || completionCuePlayedRef.current) return;
    completionCuePlayedRef.current = true;
    // A strong result gets one short celebration when the results screen
    // actually appears. Lower scores already received their answer cue and
    // avoid an overly casino-like reward sound.
    if (correctCount >= Math.ceil(questions.length * 0.6)) playSound('win', { volume: 0.82 });
  }, [correctCount, finished, playSound, questions.length]);

  const switchMode = useCallback(() => {
    const nextMode: TriviaMode = mode === 'snow' ? 'mixed' : 'snow';
    setMode(nextMode);
    modeValueRef.current = nextMode;
    try { localStorage.setItem(MODE_STORAGE_KEY, nextMode); } catch { /* keep the in-memory choice */ }
    resetRound(nextMode);
  }, [mode, resetRound]);

  const switchDifficulty = useCallback(() => {
    const next = DIFFICULTIES[(DIFFICULTIES.indexOf(difficulty) + 1) % DIFFICULTIES.length];
    setDifficulty(next);
    try { localStorage.setItem(DIFFICULTY_STORAGE_KEY, next); } catch { /* keep in memory */ }
    resetRound(mode);
  }, [difficulty, mode, resetRound]);

  useEffect(() => {
    if (!finished || !user || settlementSentRef.current) return;
    settlementSentRef.current = true;
    void gameSocket.playArcade({
      game: 'trivia', bet: DIFFICULTY_BET[difficulty], correct: correctCount,
      total: questions.length, score, difficulty, mode,
    }).then((response) => {
      if (response?.ok) setCoinPayout(Number(response.payout) || 0);
      else setSettleError(response?.error === 'insufficient_balance' ? 'Not enough Snow Coins for this challenge.' : 'Score kept; coin settlement unavailable.');
    }).catch(() => setSettleError('Score kept; coin settlement unavailable.'));
  }, [correctCount, difficulty, finished, mode, questions.length, score, user]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      const direction = visualArrowDir(event);
      if (!direction) return;
      // The game owns every arrow, including graph boundaries, so the native
      // WebView never creates a second, invisible spatial-focus cursor.
      event.preventDefault();

      if (focusZone === 'back') {
        if (direction === 'right') setFocusZone('mode');
        else if (direction === 'down') {
          if (finished) setFocusZone('next');
          else { setFocusZone('answer'); setAnswerIndex(0); }
        }
        return;
      }
      if (focusZone === 'mode') {
        if (direction === 'left') setFocusZone('back');
        else if (direction === 'right') setFocusZone('difficulty');
        else if (direction === 'down') {
          if (finished) setFocusZone('next');
          else { setFocusZone('answer'); setAnswerIndex(0); }
        }
        return;
      }
      if (focusZone === 'difficulty') {
        if (direction === 'left') setFocusZone('mode');
        else if (direction === 'right') setFocusZone('audio');
        else if (direction === 'down') {
          if (finished) setFocusZone('next');
          else { setFocusZone('answer'); setAnswerIndex(1); }
        }
        return;
      }
      if (focusZone === 'audio') {
        if (direction === 'left') setFocusZone('difficulty');
        else if (direction === 'right') setFocusZone('fx');
        else if (direction === 'down') {
          if (finished) setFocusZone('next');
          else { setFocusZone('answer'); setAnswerIndex(1); }
        }
        return;
      }
      if (focusZone === 'fx') {
        if (direction === 'left') setFocusZone('audio');
        else if (direction === 'down') {
          if (finished) setFocusZone('next');
          else { setFocusZone('answer'); setAnswerIndex(1); }
        }
        return;
      }
      if (focusZone === 'next') {
        if (direction === 'up') {
          if (finished) setFocusZone('back');
          else { setFocusZone('answer'); setAnswerIndex(2); }
        } else if (direction === 'left') setFocusZone('back');
        else if (direction === 'right') setFocusZone('fx');
        return;
      }

      if (direction === 'left') {
        if (answerIndex % 2 === 1) setAnswerIndex(answerIndex - 1);
        else setFocusZone('back');
      } else if (direction === 'right') {
        if (answerIndex % 2 === 0) setAnswerIndex(answerIndex + 1);
        else setFocusZone('fx');
      } else if (direction === 'up') {
        if (answerIndex >= 2) setAnswerIndex(answerIndex - 2);
        else setFocusZone(answerIndex === 0 ? 'back' : 'fx');
      } else if (answerIndex < 2) {
        setAnswerIndex(answerIndex + 2);
      } else if (selectedAnswer !== null) {
        setFocusZone('next');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [answerIndex, finished, focusZone, selectedAnswer]);

  const resultTitle = useMemo(() => {
    if (correctCount === questions.length) return 'Perfect game!';
    if (correctCount >= 8) return 'Trivia legend!';
    if (correctCount >= 6) return 'Brilliant run!';
    if (correctCount >= 3) return 'Nice work!';
    return 'Ready for a rematch?';
  }, [correctCount, questions.length]);

  return (
    <GameShell accent="violet" className="snow-trivia">
      <header className="snow-trivia__topbar">
        <BackButton
          ref={backRef}
          onClick={requestBack}
          onFocus={() => setFocusZone('back')}
          label="Back to Lounge"
          focused={focusZone === 'back'}
          data-tv-focused={focusZone === 'back' ? 'true' : 'false'}
          className="snow-trivia__back"
        />

        <div className="snow-trivia__brand" aria-label="TV Trivia">
          <span className="snow-trivia__brand-icon" aria-hidden="true"><Brain /></span>
          <span><small>Snow Media Lounge</small><strong>TV Trivia</strong></span>
        </div>

        <div className="snow-trivia__toolbar">
          <div className="snow-trivia-stat snow-trivia-stat--score" aria-label={`Score ${score.toLocaleString()}`}>
            <Trophy aria-hidden="true" />
            <span><small>Score</small><strong>{score.toLocaleString()}</strong></span>
          </div>
          <div className={`snow-trivia-stat snow-trivia-stat--streak${streak >= 2 ? ' is-hot' : ''}`} aria-label={`Streak ${streak}`}>
            <Flame aria-hidden="true" />
            <span><small>Streak</small><strong>{streak}</strong></span>
          </div>
          <Button
            ref={modeRef}
            type="button"
            variant="navy"
            size="sm"
            onClick={switchMode}
            onFocus={() => setFocusZone('mode')}
            aria-label={`${mode === 'snow' ? 'Snow Media and streaming mode' : 'Real world random mode'}. Press OK to switch.`}
            aria-pressed={mode === 'snow'}
            data-tv-focused={focusZone === 'mode' ? 'true' : 'false'}
            className={`snow-trivia__mode snow-trivia__mode--${mode}`}
          >
            {mode === 'snow' ? <Snowflake /> : <Globe2 />}
            <span><small>Challenge</small><strong>{mode === 'snow' ? 'Snow Media' : 'Real World'}</strong></span>
          </Button>
          <Button
            ref={difficultyRef}
            type="button"
            variant="navy"
            size="sm"
            onClick={switchDifficulty}
            onFocus={() => setFocusZone('difficulty')}
            aria-label={`${difficulty} difficulty. Press OK to switch.`}
            data-tv-focused={focusZone === 'difficulty' ? 'true' : 'false'}
            className={`snow-trivia__difficulty snow-trivia__difficulty--${difficulty}`}
          >
            <Flame /> <span><small>Difficulty</small><strong>{difficulty}</strong></span>
          </Button>
          <Button
            ref={audioRef}
            type="button"
            variant="navy"
            size="icon"
            onClick={(event) => toggleMuted(event)}
            onFocus={() => setFocusZone('audio')}
            aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}
            aria-pressed={muted}
            data-tv-focused={focusZone === 'audio' ? 'true' : 'false'}
            className="snow-trivia__sound"
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Button
            ref={fxRef}
            type="button"
            variant="navy"
            size="sm"
            onClick={toggleReducedFx}
            onFocus={() => setFocusZone('fx')}
            aria-pressed={reducedFx}
            data-tv-focused={focusZone === 'fx' ? 'true' : 'false'}
            className="snow-trivia__fx"
          >
            <Sparkles /> {reducedFx ? 'FX Low' : 'FX Full'}
          </Button>
        </div>
      </header>

      <section className="snow-trivia__progress" aria-label="Session progress">
        <div className="snow-trivia__round">
          <span>{finished ? 'Session complete' : `Question ${questionIndex + 1} of ${questions.length}`}</span>
          <div className="snow-trivia__progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={finished ? questions.length : questionIndex + 1}>
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="snow-trivia__free-play">
          <Sparkles aria-hidden="true" />
          <span>{mode === 'snow' ? 'Snow Media & Streaming' : 'Real World Random'} · {difficulty} · {user ? `${DIFFICULTY_BET[difficulty]} Snow Coins · Balance ${balance?.toLocaleString() ?? '—'}` : 'Guest practice'}</span>
          <i>{contentSource === 'network' ? 'Updated' : 'Offline ready'}</i>
        </div>
      </section>

      {!finished ? (
        <section className={`snow-trivia__stage snow-trivia__stage--${question.category}`} aria-label="Trivia question">
          <div className="snow-trivia__question-card">
            <div className="snow-trivia__category"><CategoryIcon category={question.category} /> {question.categoryLabel}</div>
            <h2>{question.prompt}</h2>
            <span className="snow-trivia__question-mark" aria-hidden="true">?</span>
          </div>

          <div className="snow-trivia__answers" role="group" aria-label="Choose an answer">
            {question.answers.map((answer, index) => {
              const isCorrect = selectedAnswer !== null && index === question.correct;
              const isSelected = selectedAnswer === index;
              const answerState = selectedAnswer === null
                ? ''
                : isCorrect
                  ? ' is-correct'
                  : isSelected
                    ? ' is-wrong'
                    : ' is-dimmed';
              const stateLabel = isCorrect ? ', correct answer' : isSelected ? ', your answer, incorrect' : '';
              return (
                <button
                  key={answer}
                  ref={(element) => { answerRefs.current[index] = element; }}
                  type="button"
                  onClick={() => answerQuestion(index)}
                  onFocus={() => { setFocusZone('answer'); setAnswerIndex(index); }}
                  aria-label={`${ANSWER_LETTERS[index]}. ${answer}${stateLabel}`}
                  aria-pressed={isSelected}
                  data-trivia-answer={index}
                  data-tv-focused={focusZone === 'answer' && answerIndex === index ? 'true' : 'false'}
                  className={`snow-trivia-answer${answerState}`}
                >
                  <span className="snow-trivia-answer__letter">{ANSWER_LETTERS[index]}</span>
                  <span className="snow-trivia-answer__text">{answer}</span>
                  <span className="snow-trivia-answer__state" aria-hidden="true">
                    {isCorrect ? <Check /> : isSelected ? <X /> : null}
                  </span>
                </button>
              );
            })}
          </div>

          <div className={`snow-trivia__feedback${selectedAnswer !== null ? ' is-revealed' : ''}`} role="status" aria-live="polite">
            {selectedAnswer === null ? (
              <div className="snow-trivia__hint">
                <span className="snow-trivia__remote" aria-hidden="true"><i>▲</i><i>◀</i><i>OK</i><i>▶</i><i>▼</i></span>
                <span><strong>Pick your answer</strong><small>Use the D-pad and press OK</small></span>
              </div>
            ) : (
              <>
                <div className={`snow-trivia__verdict${answeredCorrectly ? ' is-correct' : ' is-wrong'}`}>
                  <span>{answeredCorrectly ? <Check /> : <X />}</span>
                  <div>
                    <strong>{answeredCorrectly ? `Correct! +${Math.round((question.points ?? 100) * DIFFICULTY_POINTS[difficulty]) + Math.max(0, streak - 1) * 25}` : 'Not quite'}</strong>
                    <small>{question.fact}</small>
                  </div>
                </div>
                <Button
                  ref={nextRef}
                  type="button"
                  onClick={advance}
                  onFocus={() => setFocusZone('next')}
                  data-tv-focused={focusZone === 'next' ? 'true' : 'false'}
                  className="snow-trivia__next"
                >
                  {questionIndex === questions.length - 1 ? 'See Results' : 'Next Question'} <ArrowRight />
                </Button>
                {answeredCorrectly && !reducedFx && (
                  <div className="snow-trivia__burst" aria-hidden="true">
                    {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="snow-trivia__results" aria-label="Trivia results">
          <div className="snow-trivia__trophy" aria-hidden="true">
            <span><Trophy /></span>
            <i /><i /><i />
          </div>
          <small>Session Complete</small>
          <h2>{resultTitle}</h2>
          <p>You answered <strong>{correctCount} of {questions.length}</strong> questions correctly.</p>
          <div className="snow-trivia__results-grid">
            <div><Trophy /><span><small>Final score</small><strong>{score.toLocaleString()}</strong></span></div>
            <div><Flame /><span><small>Best streak</small><strong>{bestStreak}</strong></span></div>
            <div><Check /><span><small>Correct</small><strong>{correctCount}</strong></span></div>
          </div>
          <Button
            ref={nextRef}
            type="button"
            onClick={playAgain}
            onFocus={() => setFocusZone('next')}
            data-tv-focused={focusZone === 'next' ? 'true' : 'false'}
            className="snow-trivia__replay"
          >
            <RotateCcw /> Play Another Round
          </Button>
          <span className="snow-trivia__results-note">
            {coinPayout !== null
              ? `${coinPayout.toLocaleString()} Snow Coins returned · leaderboard score posted`
              : settleError ?? (user ? `Settling ${DIFFICULTY_BET[difficulty]} Snow Coin challenge…` : 'Guest practice · sign in for Snow Coin rounds and leaderboard scores')}
          </span>
        </section>
      )}
    </GameShell>
  );
};

export default TVTrivia;
