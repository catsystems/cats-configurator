<template>
  <v-card>
    <v-card-title class="d-flex align-center flex-wrap ga-2 pa-5">
      <h2 id="radio-guide-title" class="radio-guide-title">
        Install GS radio firmware
      </h2>
      <v-spacer />
      <v-btn variant="text" @click="$emit('close')">Close guide</v-btn>
    </v-card-title>
    <v-card-text class="px-5 pb-6">
      <p class="text-body-1 mb-3">
        Configurator prepares the firmware file. Finish the installation on the
        Ground Station to update both radio receivers.
      </p>
      <p class="text-body-2 text-medium-emphasis mb-6">
        Screenshots are from the GS simulator. Filenames, versions, sizes and
        checksums are examples; yours may differ. Use the arrow buttons to
        navigate, A to select or install, and B to go back.
      </p>
      <ol class="radio-guide-steps">
        <li v-for="step in steps" :key="step.title">
          <h3 class="text-h6 mb-2">{{ step.title }}</h3>
          <p class="text-body-1">{{ step.text }}</p>
          <div v-if="step.images" class="radio-guide-images mt-4">
            <img
              v-for="picture in step.images"
              :key="picture.src"
              :src="picture.src"
              :alt="picture.alt"
              width="400"
              height="240"
              loading="lazy"
            />
          </div>
        </li>
      </ol>
      <v-alert type="info" variant="tonal" class="mt-6">
        If either receiver reports a failure, follow the recovery message on the
        GS. A prepared file or a completed progress bar does not confirm
        installation; check the final result for both radios.
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<script>
import settings from "@/assets/radio-update/settings.png";
import receivers from "@/assets/radio-update/receivers.png";
import file from "@/assets/radio-update/file.png";
import confirm from "@/assets/radio-update/confirm.png";
import progress from "@/assets/radio-update/progress.png";
import complete from "@/assets/radio-update/complete.png";

export default {
  name: "RadioUpdateGuide",
  emits: ["close"],
  data: () => ({
    steps: [
      {
        title: "Prepare the file and safely eject the drive",
        text: "Stop tracking, recording and radio testing. In Configurator, choose Prepare radio firmware and wait until the file is ready. Close any open GS files, then safely eject its USB drive using your computer. Keep the USB cable connected and the GS powered.",
      },
      {
        title: "Open Radio Receivers on the GS",
        text: "Open Settings, move to the System page, select Update Firmware and press A. Choose Radio Receivers and press A again.",
        images: [
          {
            src: settings,
            alt: "GS System settings with Update Firmware selected.",
          },
          {
            src: receivers,
            alt: "GS Update Firmware menu with Radio Receivers selected.",
          },
        ],
      },
      {
        title: "Select the prepared firmware file",
        text: "Choose the .bin file Configurator just prepared in telemetry_firmware, then press A. If the list is empty, check that file preparation finished. If the GS asks you to eject the USB drive, safely eject it on your computer and try again.",
        images: [
          {
            src: file,
            alt: "GS radio firmware list showing the example telemetry-1.2.0.bin file.",
          },
        ],
      },
      {
        title: "Confirm and let both radios update",
        text: "Check the selected filename, then press A (Install). The GS updates Radio 1, verifies it, then updates Radio 2. Keep power connected and wait for the final result. Do not start another firmware update in Configurator while this runs.",
        images: [
          {
            src: confirm,
            alt: "GS Confirm Radio Update screen with Install (A) and a reminder to keep power connected.",
          },
          {
            src: progress,
            alt: "GS writing firmware to Radio 1 with a progress bar.",
          },
        ],
      },
      {
        title: "Check Both radios verified",
        text: "Confirm that the GS shows Both radios verified and that both Link 1 and Link 2 report the version you prepared. Once the update is complete, press B to go back. Power-cycle the GS, reconnect its USB drive, then use Check devices & releases in Configurator to refresh the displayed versions.",
        images: [
          {
            src: complete,
            alt: "GS Radio Update Complete screen showing Both radios verified and a version for each link.",
          },
        ],
      },
    ],
  }),
};
</script>

<style scoped>
.radio-guide-title {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.3;
  white-space: normal;
}
.radio-guide-steps h3 {
  margin-top: 0;
  font-size: 1.125rem;
}
.radio-guide-steps {
  padding-left: 1.5rem;
}
.radio-guide-steps > li + li {
  margin-top: 2rem;
}
.radio-guide-steps > li::marker {
  font-weight: 600;
}
.radio-guide-images {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.radio-guide-images img {
  display: block;
  max-width: 100%;
  height: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 4px;
  image-rendering: pixelated;
}
</style>
