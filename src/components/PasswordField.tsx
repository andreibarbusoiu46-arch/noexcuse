import { useState } from 'react';
import { View } from 'react-native';
import { t } from '@/i18n';
import { passwordStrength } from '@/lib/auth';
import { color } from '@/theme/tokens';
import { Field } from './Field';
import { Icon } from './Icon';
import { Tap } from './Tap';
import { T } from './Text';

type Props = {
  label: string; value: string; onChangeText: (v: string) => void;
  /** "new" shows the strength meter and the rules; "current" is a plain sign-in field. */
  mode: 'new' | 'current' | 'confirm';
  email?: string; onSubmitEditing?: () => void; returnKeyType?: 'next' | 'go' | 'done';
};

/** Password input with show/hide, and for new passwords a strength meter with the rules still missing. */
export function PasswordField({ label, value, onChangeText, mode, email, onSubmitEditing, returnKeyType }: Props) {
  const [show, setShow] = useState(false);
  const s = passwordStrength(value, email);
  const tones = [color.status.danger, color.status.danger, color.status.warning, color.status.success, color.status.success];
  return (
    <View style={{ gap: 8 }}>
      <View>
        <Field label={label} value={value} onChangeText={onChangeText} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
          autoComplete={mode === 'current' ? 'current-password' : 'new-password'} textContentType={mode === 'current' ? 'password' : 'newPassword'}
          placeholder="••••••••••" onSubmitEditing={onSubmitEditing} returnKeyType={returnKeyType} style={{ paddingRight: 52 }} />
        <Tap onPress={() => setShow((x) => !x)} accessibilityRole="button" accessibilityLabel={show ? t.auth.hide : t.auth.show}
          style={{ position: 'absolute', right: 6, bottom: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={show ? 'EyeOff' : 'Eye'} size={18} tint={color.icon.secondary} />
        </Tap>
      </View>
      {mode === 'new' && value.length > 0 ? (
        <View style={{ gap: 6 }} accessible accessibilityLabel={`${t.auth.pw.label}: ${t.auth.pw.strength[s.score]}`} accessibilityLiveRegion="polite">
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < Math.max(1, s.score) ? tones[s.score] : color.border.hairline }} />
            ))}
          </View>
          <T variant="caption" tone={s.ok ? 'secondary' : 'warning'}>{t.auth.pw.strength[s.score]}{s.problems.length ? ` · ${s.problems.join(' · ')}` : ''}</T>
        </View>
      ) : null}
    </View>
  );
}
