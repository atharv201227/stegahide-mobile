import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import {
  embedImage,
  extractImage,
  readImageBase64,
  validatePayloadCapacity,
  writeImageBase64,
} from "@/lib/steganography";

const COLORS = {
  background: "#08111F",
  surface: "#111D30",
  surfaceRaised: "#182640",
  border: "#263754",
  text: "#F4F7FB",
  muted: "#8E9CB3",
  cyan: "#50D5E8",
  orange: "#FF9D66",
  green: "#6EE7B7",
  danger: "#FCA5A5",
};

type Mode = "hide" | "reveal";
type PickTarget = "carrier" | "secret";
type CapacityNotice = { text: string; ok: boolean };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type ImageSlotProps = {
  label: string;
  hint: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  uri: string | null;
  fileName: string | null;
  accent: string;
  onPress: () => void;
};

function ImageSlot({ label, hint, icon, uri, fileName, accent, onPress }: ImageSlotProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.imageSlot, pressed && styles.pressed]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.slotImage} resizeMode="cover" />
      ) : (
        <View style={[styles.slotIcon, { backgroundColor: `${accent}18` }]}>
          <MaterialIcons name={icon} size={24} color={accent} />
        </View>
      )}
      <View style={styles.slotCopy}>
        <Text style={styles.slotLabel}>{label}</Text>
        <Text style={styles.slotHint} numberOfLines={1}>
          {fileName ?? hint}
        </Text>
      </View>
      <View style={[styles.addButton, { borderColor: `${accent}66` }]}>
        <MaterialIcons name={uri ? "check" : "add"} size={18} color={accent} />
      </View>
    </Pressable>
  );
}

function ModeButton({ mode, active, title, subtitle, icon, onPress }: {
  mode: Mode;
  active: boolean;
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}) {
  const accent = mode === "hide" ? COLORS.orange : COLORS.cyan;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        active && { backgroundColor: `${accent}18`, borderColor: `${accent}8C` },
        pressed && styles.pressed,
      ]}
    >
      <MaterialIcons name={icon} size={19} color={active ? accent : COLORS.muted} />
      <View style={styles.modeCopy}>
        <Text style={[styles.modeTitle, active && { color: COLORS.text }]}>{title}</Text>
        <Text style={styles.modeSubtitle}>{subtitle}</Text>
      </View>
      {active && <View style={[styles.activeDot, { backgroundColor: accent }]} />}
    </Pressable>
  );
}

export default function HomeScreen() {
  const [mode, setMode] = useState<Mode>("hide");
  const [carrierUri, setCarrierUri] = useState<string | null>(null);
  const [secretUri, setSecretUri] = useState<string | null>(null);
  const [carrierName, setCarrierName] = useState<string | null>(null);
  const [secretName, setSecretName] = useState<string | null>(null);
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [capacityNotice, setCapacityNotice] = useState<CapacityNotice | null>(null);

  const ready = mode === "hide" ? Boolean(carrierUri && secretUri) : Boolean(carrierUri);
  const actionLabel = useMemo(() => (mode === "hide" ? "Create hidden image" : "Reveal hidden image"), [mode]);

  const changeMode = (nextMode: Mode) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMode(nextMode);
    setResultUri(null);
    setMessage(null);
    setCapacityNotice(null);
  };

  const pickImage = async (target: PickTarget) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (target === "carrier") {
      setCarrierUri(asset.uri);
      setCarrierName(asset.fileName ?? "Carrier image selected");
      setResultUri(null);
    } else {
      setSecretUri(asset.uri);
      setSecretName(asset.fileName ?? "Secret image selected");
      setResultUri(null);
    }
    setMessage(null);
    setCapacityNotice(null);
  };

  const processImages = async () => {
    if (!ready || !carrierUri) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "hide" && secretUri) {
        const normalized = await ImageManipulator.manipulateAsync(
          carrierUri,
          [],
          { compress: 1, format: ImageManipulator.SaveFormat.PNG, base64: true },
        );
        if (!normalized.base64) throw new Error("Could not read the carrier image");
        const normalizedSecret = await ImageManipulator.manipulateAsync(
          secretUri,
          [],
          { compress: 1, format: ImageManipulator.SaveFormat.PNG, base64: true },
        );
        if (!normalizedSecret.base64) throw new Error("Could not read the secret image");
        const capacity = validatePayloadCapacity({
          carrierWidth: normalized.width,
          carrierHeight: normalized.height,
          payloadWidth: normalizedSecret.width,
          payloadHeight: normalizedSecret.height,
          payloadBase64: normalizedSecret.base64,
          payloadMimeType: "image/png",
        });
        if (!capacity.fits) {
          const reason = !capacity.dimensionsFit
            ? `Secret image is ${normalizedSecret.width}×${normalizedSecret.height}px, but the carrier is ${normalized.width}×${normalized.height}px.`
            : `Secret image needs ${formatBytes(capacity.payloadBytes)}, but this carrier safely supports ${formatBytes(capacity.maxPayloadBytes)}.`;
          setCapacityNotice({ text: `Capacity check failed · ${reason}`, ok: false });
          throw new Error("The secret image is too large for this carrier. Choose a larger carrier or a smaller secret image.");
        }
        setCapacityNotice({ text: `Capacity check passed · ${formatBytes(capacity.remainingBytes)} remaining`, ok: true });
        const encoded = embedImage(normalized.base64, normalizedSecret.base64, "image/png");
        const uri = await writeImageBase64(
          encoded,
          "image/png",
        );
        setResultUri(uri);
        setMessage("Your carrier image now contains the secret image.");
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        const carrierBase64 = await readImageBase64(carrierUri);
        const extracted = extractImage(carrierBase64);
        const uri = await writeImageBase64(extracted.base64, extracted.mimeType);
        setResultUri(uri);
        setMessage("Hidden image revealed successfully.");
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Something went wrong";
      setMessage(text);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  const saveResult = async () => {
    if (!resultUri) return;
    try {
      if (Platform.OS === "web") {
        setMessage("Gallery saving is available on Android and iOS.");
        return;
      }
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) throw new Error("Photo permission is needed to save this image");
      await MediaLibrary.createAssetAsync(resultUri);
      setMessage("Saved to your photo library.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert("Could not save image", error instanceof Error ? error.message : "Try again");
    }
  };

  const shareResult = async () => {
    if (!resultUri) return;
    if (!(await Sharing.isAvailableAsync())) {
      setMessage("Sharing is not available on this device.");
      return;
    }
    await Sharing.shareAsync(resultUri, { mimeType: "image/png", dialogTitle: "Share StegaHide image" });
  };

  const reset = () => {
    setCarrierUri(null);
    setSecretUri(null);
    setCarrierName(null);
    setSecretName(null);
    setResultUri(null);
    setMessage(null);
    setCapacityNotice(null);
  };

  return (
    <ScreenContainer containerClassName="bg-background" className="px-5" edges={["top", "left", "right"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.topBar}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}>
              <MaterialIcons name="blur-on" size={22} color={COLORS.background} />
            </View>
            <View>
              <Text style={styles.brandName}>StegaHide</Text>
              <Text style={styles.brandCaption}>PRIVATE IMAGE STUDIO</Text>
            </View>
          </View>
          <View style={styles.localPill}>
            <View style={styles.liveDot} />
            <Text style={styles.localPillText}>LOCAL</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <Text style={styles.eyebrow}>IMAGE STEGANOGRAPHY</Text>
          <Text style={styles.heroTitle}>Hide images{`\n`}in plain sight.</Text>
          <Text style={styles.heroDescription}>
            Blend a private image into an ordinary one. Nothing leaves your device.
          </Text>
          <View style={styles.heroMeta}>
            <View style={styles.metaItem}><MaterialIcons name="lock-outline" size={14} color={COLORS.green} /><Text style={styles.metaText}>Offline by default</Text></View>
            <View style={styles.metaItem}><MaterialIcons name="bolt" size={14} color={COLORS.orange} /><Text style={styles.metaText}>Instant processing</Text></View>
          </View>
        </View>

        <View style={styles.modeSwitch}>
          <ModeButton mode="hide" active={mode === "hide"} title="Hide" subtitle="Embed an image" icon="layers" onPress={() => changeMode("hide")} />
          <ModeButton mode="reveal" active={mode === "reveal"} title="Reveal" subtitle="Extract an image" icon="visibility" onPress={() => changeMode("reveal")} />
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>{mode === "hide" ? "Build your hidden image" : "Open a hidden image"}</Text>
            <Text style={styles.sectionSubtitle}>{mode === "hide" ? "Choose two images to combine" : "Select a StegaHide carrier image"}</Text>
          </View>
          {(carrierUri || secretUri || resultUri) && (
            <Pressable onPress={reset} style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}>
              <MaterialIcons name="refresh" size={16} color={COLORS.muted} />
              <Text style={styles.resetText}>Reset</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          <ImageSlot label="Carrier image" hint="The visible image" icon="photo" uri={carrierUri} fileName={carrierName} accent={COLORS.orange} onPress={() => pickImage("carrier")} />
          {mode === "hide" && <View style={styles.connector}><View style={styles.connectorLine} /><View style={styles.connectorBadge}><MaterialIcons name="add" size={14} color={COLORS.muted} /></View><View style={styles.connectorLine} /></View>}
          {mode === "hide" && <ImageSlot label="Secret image" hint="The image to hide" icon="image-search" uri={secretUri} fileName={secretName} accent={COLORS.cyan} onPress={() => pickImage("secret")} />}
        </View>

        <View style={styles.tipRow}>
          <MaterialIcons name="info-outline" size={17} color={COLORS.cyan} />
          <Text style={styles.tipText}>Capacity uses a conservative pixel budget so hidden images fit reliably.</Text>
        </View>

        {capacityNotice && (
          <View style={[styles.capacityNotice, capacityNotice.ok ? styles.capacitySuccess : styles.capacityError]}>
            <MaterialIcons name={capacityNotice.ok ? "check-circle" : "warning-amber"} size={17} color={capacityNotice.ok ? COLORS.green : COLORS.danger} />
            <Text style={styles.capacityText}>{capacityNotice.text}</Text>
          </View>
        )}

        <Pressable
          onPress={processImages}
          disabled={!ready || busy}
          style={({ pressed }) => [styles.primaryButton, (!ready || busy) && styles.primaryButtonDisabled, pressed && ready && styles.pressed]}
        >
          {busy ? <ActivityIndicator color={COLORS.background} /> : <MaterialIcons name={mode === "hide" ? "auto-fix-high" : "visibility"} size={21} color={COLORS.background} />}
          <Text style={styles.primaryButtonText}>{busy ? "Processing locally…" : actionLabel}</Text>
          {!busy && <MaterialIcons name="arrow-forward" size={19} color={COLORS.background} />}
        </Pressable>

        {message && (
          <View style={[styles.message, message.includes("successfully") || message.includes("now contains") || message.includes("Saved") ? styles.messageSuccess : styles.messageError]}>
            <MaterialIcons name={message.includes("successfully") || message.includes("now contains") || message.includes("Saved") ? "check-circle" : "info-outline"} size={17} color={message.includes("successfully") || message.includes("now contains") || message.includes("Saved") ? COLORS.green : COLORS.danger} />
            <Text style={styles.messageText}>{message}</Text>
          </View>
        )}

        {resultUri && (
          <View style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <View>
                <Text style={styles.resultEyebrow}>{mode === "hide" ? "READY TO EXPORT" : "EXTRACTED PAYLOAD"}</Text>
                <Text style={styles.resultTitle}>{mode === "hide" ? "Hidden image created" : "Secret image revealed"}</Text>
              </View>
              <View style={styles.resultCheck}><MaterialIcons name="check" size={17} color={COLORS.background} /></View>
            </View>
            <Image source={{ uri: resultUri }} style={styles.resultImage} resizeMode="cover" />
            <View style={styles.actionRow}>
              <Pressable onPress={saveResult} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><MaterialIcons name="download" size={18} color={COLORS.text} /><Text style={styles.secondaryText}>Save</Text></Pressable>
              <Pressable onPress={shareResult} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><MaterialIcons name="ios-share" size={18} color={COLORS.text} /><Text style={styles.secondaryText}>Share</Text></Pressable>
            </View>
          </View>
        )}

        <View style={styles.footerStats}>
          <View style={styles.stat}><Text style={styles.statValue}>100%</Text><Text style={styles.statLabel}>ON DEVICE</Text></View>
          <View style={styles.statDivider} />
          <View style={styles.stat}><Text style={styles.statValue}>PNG</Text><Text style={styles.statLabel}>CARRIER FORMAT</Text></View>
          <View style={styles.statDivider} />
          <View style={styles.stat}><Text style={styles.statValue}>0</Text><Text style={styles.statLabel}>UPLOADS</Text></View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingTop: 10, paddingBottom: 38 },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.orange },
  brandName: { color: COLORS.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  brandCaption: { color: COLORS.muted, fontSize: 8, letterSpacing: 1.7, marginTop: 3, fontWeight: "700" },
  localPill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 99, borderWidth: 1, borderColor: `${COLORS.green}45`, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: `${COLORS.green}0D` },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green },
  localPillText: { color: COLORS.green, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  hero: { overflow: "hidden", borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, padding: 22, marginBottom: 14 },
  heroGlow: { position: "absolute", width: 190, height: 190, borderRadius: 95, right: -72, top: -78, backgroundColor: `${COLORS.cyan}12` },
  eyebrow: { color: COLORS.cyan, fontSize: 10, letterSpacing: 1.8, fontWeight: "800", marginBottom: 11 },
  heroTitle: { color: COLORS.text, fontSize: 33, lineHeight: 36, fontWeight: "800", letterSpacing: -1.1 },
  heroDescription: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginTop: 13, maxWidth: 290 },
  heroMeta: { flexDirection: "row", gap: 16, marginTop: 21, flexWrap: "wrap" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
  modeSwitch: { flexDirection: "row", gap: 9, marginBottom: 26 },
  modeButton: { flex: 1, minHeight: 66, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: `${COLORS.surface}88` },
  modeCopy: { flex: 1 },
  modeTitle: { color: COLORS.muted, fontSize: 13, fontWeight: "800" },
  modeSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  activeDot: { width: 7, height: 7, borderRadius: 4 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 11 },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  sectionSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  resetButton: { flexDirection: "row", alignItems: "center", gap: 4, padding: 5 },
  resetText: { color: COLORS.muted, fontSize: 11, fontWeight: "700" },
  card: { backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, padding: 11 },
  imageSlot: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 14, backgroundColor: `${COLORS.surfaceRaised}AA`, borderWidth: 1, borderColor: `${COLORS.border}99` },
  slotImage: { width: 70, height: 70, borderRadius: 10, backgroundColor: COLORS.background },
  slotIcon: { width: 70, height: 70, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  slotCopy: { flex: 1, minWidth: 0 },
  slotLabel: { color: COLORS.text, fontSize: 14, fontWeight: "800" },
  slotHint: { color: COLORS.muted, fontSize: 11, marginTop: 5 },
  addButton: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  connector: { height: 27, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  connectorLine: { width: 58, height: 1, backgroundColor: COLORS.border },
  connectorBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 3, marginTop: 12, marginBottom: 15 },
  tipText: { flex: 1, color: COLORS.muted, fontSize: 11, lineHeight: 16 },
  capacityNotice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 13, padding: 12, marginTop: -3, marginBottom: 13, borderWidth: 1 },
  capacitySuccess: { backgroundColor: `${COLORS.green}10`, borderColor: `${COLORS.green}35` },
  capacityError: { backgroundColor: `${COLORS.danger}10`, borderColor: `${COLORS.danger}35` },
  capacityText: { flex: 1, color: COLORS.muted, fontSize: 11, lineHeight: 16 },
  primaryButton: { minHeight: 56, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: COLORS.orange },
  primaryButtonDisabled: { opacity: 0.42 },
  primaryButtonText: { color: COLORS.background, fontSize: 14, fontWeight: "900", letterSpacing: -0.1 },
  message: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 13, padding: 12, marginTop: 13, borderWidth: 1 },
  messageSuccess: { backgroundColor: `${COLORS.green}10`, borderColor: `${COLORS.green}35` },
  messageError: { backgroundColor: `${COLORS.danger}10`, borderColor: `${COLORS.danger}35` },
  messageText: { flex: 1, color: COLORS.muted, fontSize: 12, lineHeight: 17 },
  resultCard: { marginTop: 18, backgroundColor: COLORS.surface, borderRadius: 20, padding: 12, borderWidth: 1, borderColor: `${COLORS.green}3A` },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, marginBottom: 11 },
  resultEyebrow: { color: COLORS.green, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  resultTitle: { color: COLORS.text, fontSize: 17, fontWeight: "800", marginTop: 4 },
  resultCheck: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.green },
  resultImage: { width: "100%", height: 190, borderRadius: 13, backgroundColor: COLORS.background },
  actionRow: { flexDirection: "row", gap: 9, marginTop: 10 },
  secondaryButton: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, backgroundColor: `${COLORS.surfaceRaised}90` },
  secondaryText: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
  footerStats: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", marginTop: 26, paddingTop: 17, borderTopWidth: 1, borderTopColor: COLORS.border },
  stat: { alignItems: "center", gap: 5 },
  statValue: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
  statLabel: { color: COLORS.muted, fontSize: 8, letterSpacing: 1.1, fontWeight: "800" },
  statDivider: { width: 1, height: 25, backgroundColor: COLORS.border },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
});
