import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { GameReviewClient } from '../../../components/GameReviewClient';
import { fetchGame, fetchGameAnalysis, fetchGameAnalysisSeries, fetchGameMoves } from '../../../lib/api';
import { ANON_COOKIE, USERNAME_COOKIE, decodeCookieValue } from '../../../lib/preferences';

export default async function GameReviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const gameId = Number(params.id);
  if (Number.isNaN(gameId)) {
    notFound();
  }

  const cookieStore = cookies();
  const anonymizeCookie = cookieStore.get(ANON_COOKIE)?.value;
  const usernameCookie = cookieStore.get(USERNAME_COOKIE)?.value;
  const playerUsername = decodeCookieValue(usernameCookie);
  const anonymize =
    (Array.isArray(searchParams.anonymize) ? searchParams.anonymize[0] : searchParams.anonymize) ??
    (anonymizeCookie === 'true' ? 'true' : undefined);
  const moveIdRaw = Array.isArray(searchParams.move_id)
    ? searchParams.move_id[0]
    : searchParams.move_id;
  const moveId = moveIdRaw ? Number(moveIdRaw) : null;
  const initialMoveId = moveId && !Number.isNaN(moveId) ? moveId : undefined;

  const game = await fetchGame(gameId, { anonymize }).catch(() => null);
  if (!game) {
    notFound();
  }
  const [moves, analysis, series] = await Promise.all([
    fetchGameMoves(gameId),
    fetchGameAnalysis(gameId),
    fetchGameAnalysisSeries(gameId),
  ]);

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h1>Game Review</h1>
          <p>
            Deep review with engine truth layer. Every insight is tied to a move and position.
          </p>
        </div>
      </section>

      <GameReviewClient
        game={game}
        moves={moves}
        analysis={analysis}
        series={series}
        initialMoveId={initialMoveId}
        playerUsername={playerUsername}
      />
    </div>
  );
}
