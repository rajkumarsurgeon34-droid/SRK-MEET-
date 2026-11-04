package com.srk.meet.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object Palette {
    val Bg = Color(0xFF0B1220)
    val Surface = Color(0xFF121A2B)
    val Card = Color(0xFF1A2438)
    val CardHigh = Color(0xFF243049)
    val Blue = Color(0xFF2563EB)
    val Teal = Color(0xFF5EEAD4)
    val Red = Color(0xFFEF4444)
    val Amber = Color(0xFFFBBF24)
    val Text = Color(0xFFE8EEFC)
    val Muted = Color(0xFF9FB0D0)
}

@Composable
fun SrkTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.Blue,
            onPrimary = Color.White,
            secondary = Palette.Teal,
            onSecondary = Color(0xFF042F2E),
            background = Palette.Bg,
            onBackground = Palette.Text,
            surface = Palette.Surface,
            onSurface = Palette.Text,
            surfaceVariant = Palette.Card,
            onSurfaceVariant = Palette.Muted,
            surfaceContainer = Palette.Surface,
            surfaceContainerHigh = Palette.Card,
            surfaceContainerHighest = Palette.CardHigh,
            error = Palette.Red,
            outline = Color(0xFF334155),
        ),
        content = content,
    )
}
