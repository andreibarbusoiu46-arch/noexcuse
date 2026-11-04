import { router } from 'expo-router';
import { t } from '@/i18n';
import { View } from 'react-native';
import { IconButton } from './Button';
import { T } from './Text';

/** Header for pushed screens: back button, overline, serif title. */
export function BackHeader({ overline, title }: { overline?: string; title: string }) {
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row' }}>
        <IconButton icon="ChevronLeft" label={t.common.back} onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))} />
      </View>
      <View style={{ gap: 4 }}>
        {overline ? <T variant="overline" tone="tertiary">{overline}</T> : null}
        <T variant="h1" accessibilityRole="header">{title}</T>
      </View>
    </View>
  );
}
