import { Empty, Kicker, Screen, Title } from '../../ui';

/*
 * The nutrition tabs whose screens have not been built yet.
 *
 * The tab bar is the world's shape, and a shape that grows an item at a time
 * teaches the athlete's thumb the wrong position twice. So the five tabs are
 * declared now and the three that have no screen say so, in the one place a
 * screen reader and a glance both find it.
 *
 * This is NOT any of those screens in miniature. It renders no data and offers
 * no action on purpose — a half-built Food search would be worse than an
 * honest gap, and each of those screens is owned by its own slice.
 */

export function nutritionPlaceholder(title: string, body: string) {
  return function PlaceholderScreen() {
    return (
      <Screen>
        <Kicker>Nutrition</Kicker>
        <Title>{title}</Title>
        <Empty title="Not built yet" body={body} />
      </Screen>
    );
  };
}
