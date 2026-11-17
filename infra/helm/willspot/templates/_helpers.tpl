{{- define "willspot.fullname" -}}{{ .Release.Name | trunc 40 | trimSuffix "-" }}{{- end -}}

{{- define "willspot.labels" -}}
app.kubernetes.io/part-of: willspot
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* selector labels for one component: (dict "root" $ "name" "wallet") */}}
{{- define "willspot.selector" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{/* image for a component: (dict "root" $ "name" "wallet" "image" .image) */}}
{{- define "willspot.image" -}}
{{- $img := default dict .image -}}
{{- $repo := default (printf "%s/willspot-%s" .root.Values.image.registry .name) $img.repository -}}
{{- if $img.digest -}}{{ $repo }}@{{ $img.digest }}{{- else -}}{{ $repo }}:{{ default .root.Values.image.tag $img.tag }}{{- end -}}
{{- end -}}

{{- define "willspot.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: {{ .Values.podSecurity.runAsUser }}
runAsGroup: {{ .Values.podSecurity.runAsGroup }}
fsGroup: {{ .Values.podSecurity.fsGroup }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "willspot.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}
