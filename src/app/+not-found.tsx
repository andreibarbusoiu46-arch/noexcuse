import { router } from 'expo-router';
import { View } from 'react-native';
import { t } from '@/i18n';
import { Screen } from '@/components/Screen';
import { MessagePanel } from '@/components/StatePanel';

/** Any unknown address: a calm, branded dead end with one way back (no route list, no technical text). */
export default function NotFound() {
  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <MessagePanel kind="empty" icon="Target" title={t.common.notFound.title} body={t.common.notFound.body}
          action={t.common.notFound.home} onAction={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
