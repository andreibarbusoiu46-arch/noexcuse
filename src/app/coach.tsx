import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { IconButton } from '@/components/Button';
import { Glow } from '@/components/Screen';
import { MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { Upsell } from '@/components/Upsell';
import { api, type CoachMessage } from '@/data';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { useApp } from '@/providers/AppProvider';
import { color, layout, radius } from '@/theme/tokens';

const STARTERS = ['Review my last 7 days', 'Which commitment am I most likely to miss next — and why?', 'Plan tomorrow so I don’t miss anything', 'How do I raise my Discipline Score fastest?'];

/** The AI coach answers from a snapshot of your own data, built on the server. */
export default function Coach() {
  const { prompt } = useLocalSearchParams<{ prompt?: string }>();
  const { premium } = useApp();
  const insets = useSafeAreaInsets();
  const q = useLoad(() => (premium ? api.getCoachMessages(40) : Promise.resolve([] as CoachMessage[])), [premium]);
  // Messages sent in this visit, shown after the loaded history.
  const [local, setMsgs] = useState<CoachMessage[]>([]);
  const msgs = [...(q.data ?? []), ...local];
  const [text, setText] = useState(prompt ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const seq = useRef(0);

  async function send(message: string) {
    const m = message.trim();
    if (!m || busy) return;
    setBusy(true); setError(null); setText('');
    const optimistic: CoachMessage = { id: -(++seq.current), role: 'user', content: m, created_at: new Date().toISOString() };
    setMsgs((p) => [...p, optimistic]);
    try {
      const r = await api.askCoach(m);
      setMsgs((p) => [...p, { id: -(++seq.current), role: 'coach', content: r.reply, created_at: new Date().toISOString() }]);
      setRemaining(r.remaining);
      haptics.light();
    } catch (e) {
      setMsgs((p) => p.filter((x) => x.id !== optimistic.id));
      setText(m);
      setError((e as Error).message || 'The coach didn’t answer. Try again.');
      haptics.error();
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.bg.base }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Glow tone="ice" />
      <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 16, paddingHorizontal: layout.gutter, gap: 16, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' }}>
        <BackHeader overline="Built from your own data" title="Coach" />
        {!premium ? (
          <Upsell title="A coach that reads your record." body="Ask why you keep missing, plan tomorrow, or review your week. Every answer is grounded in your commitments, results and Discipline Score." />
        ) : q.loading && !q.data ? (
          <ActivityIndicator color={color.text.secondary} />
        ) : q.error && !q.data ? (
          <MessagePanel kind="error" icon="Alert" title="Couldn’t load the conversation." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
        ) : (
          <>
            {msgs.length === 0 && (
              <View style={{ gap: 10 }}>
                <T variant="bodySmall" tone="secondary">The coach sees your commitments, results, Discipline Score, recent misses and challenges — never your photos or private notes.</T>
                {STARTERS.map((s) => (
                  <Tap key={s} onPress={() => send(s)} accessibilityLabel={`Ask: ${s}`}
                    style={{ padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: color.border.hairline, backgroundColor: color.surface.card }}>
                    <T variant="bodySmall">{s}</T>
                  </Tap>
                ))}
              </View>
            )}
            {msgs.map((m) => (
              <View key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: 14, borderRadius: 20,
                backgroundColor: m.role === 'user' ? color.accent.primary : color.surface.card, borderWidth: m.role === 'user' ? 0 : 1, borderColor: color.border.hairline }}>
                <T variant="bodySmall" tone={m.role === 'user' ? 'onLight' : 'primary'} selectable>{m.content}</T>
              </View>
            ))}
            {busy && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator color={color.text.secondary} /><T variant="caption" tone="tertiary">Reading your record…</T></View>}
            {error && <T variant="bodySmall" tone="danger" accessibilityLiveRegion="assertive">{error}</T>}
          </>
        )}
      </ScrollView>
      {premium && (
        <View style={{ paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: insets.bottom + 10, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <TextInput value={text} onChangeText={setText} placeholder="Ask your coach…" placeholderTextColor={color.text.tertiary} multiline maxLength={1000}
              accessibilityLabel="Message to the coach"
              style={{ flex: 1, minHeight: 46, maxHeight: 140, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 23, color: color.text.primary,
                backgroundColor: color.surface.inset, borderWidth: 1, borderColor: color.border.hairline, fontSize: 16 }} />
            <IconButton icon="ArrowUp" label="Send" onPress={() => send(text)} />
          </View>
          {remaining !== null && <T variant="caption" tone="tertiary" align="center">{remaining} message{remaining === 1 ? '' : 's'} left today</T>}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
