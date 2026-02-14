package com.example.devicemanager.service;

import com.example.devicemanager.dto.BatchDeleteResponse;
import com.example.devicemanager.repository.DeviceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class DeviceServiceImplTest {

    @Mock
    private DeviceRepository deviceRepository;

    @InjectMocks
    private DeviceServiceImpl deviceService;

    @Test
    void batchDeleteDevices_allDevicesExist_allSuccessfullyDeleted() {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2", "device3");
        when(deviceRepository.existsById("device1")).thenReturn(true);
        when(deviceRepository.existsById("device2")).thenReturn(true);
        when(deviceRepository.existsById("device3")).thenReturn(true);

        // Act
        BatchDeleteResponse response = deviceService.batchDeleteDevices(deviceIds);

        // Assert
        assertTrue(response.isSuccess());
        assertEquals(3, response.getTotalRequested());
        assertEquals(3, response.getTotalDeleted());
        assertEquals(3, response.getDeleted().size());
        assertEquals(0, response.getFailed().size());
        assertTrue(response.getDeleted().containsAll(deviceIds));

        verify(deviceRepository, times(1)).deleteById("device1");
        verify(deviceRepository, times(1)).deleteById("device2");
        verify(deviceRepository, times(1)).deleteById("device3");
    }

    @Test
    void batchDeleteDevices_someDevicesDoNotExist_partialSuccess() {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2", "device3");
        when(deviceRepository.existsById("device1")).thenReturn(true);
        when(deviceRepository.existsById("device2")).thenReturn(false);
        when(deviceRepository.existsById("device3")).thenReturn(true);

        // Act
        BatchDeleteResponse response = deviceService.batchDeleteDevices(deviceIds);

        // Assert
        assertFalse(response.isSuccess());
        assertEquals(3, response.getTotalRequested());
        assertEquals(2, response.getTotalDeleted());
        assertEquals(2, response.getDeleted().size());
        assertEquals(1, response.getFailed().size());
        assertTrue(response.getDeleted().contains("device1"));
        assertTrue(response.getDeleted().contains("device3"));
        assertEquals("device2", response.getFailed().get(0).getDeviceId());
        assertEquals("Device not found", response.getFailed().get(0).getError());

        verify(deviceRepository, times(1)).deleteById("device1");
        verify(deviceRepository, never()).deleteById("device2");
        verify(deviceRepository, times(1)).deleteById("device3");
    }

    @Test
    void batchDeleteDevices_noDevicesExist_allFailed() {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2");
        when(deviceRepository.existsById("device1")).thenReturn(false);
        when(deviceRepository.existsById("device2")).thenReturn(false);

        // Act
        BatchDeleteResponse response = deviceService.batchDeleteDevices(deviceIds);

        // Assert
        assertFalse(response.isSuccess());
        assertEquals(2, response.getTotalRequested());
        assertEquals(0, response.getTotalDeleted());
        assertEquals(0, response.getDeleted().size());
        assertEquals(2, response.getFailed().size());

        verify(deviceRepository, never()).deleteById(anyString());
    }

    @Test
    void batchDeleteDevices_deleteThrowsException_markedAsFailed() {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2");
        when(deviceRepository.existsById("device1")).thenReturn(true);
        when(deviceRepository.existsById("device2")).thenReturn(true);
        doThrow(new RuntimeException("Database error")).when(deviceRepository).deleteById("device1");

        // Act
        BatchDeleteResponse response = deviceService.batchDeleteDevices(deviceIds);

        // Assert
        assertFalse(response.isSuccess());
        assertEquals(2, response.getTotalRequested());
        assertEquals(1, response.getTotalDeleted());
        assertEquals(1, response.getDeleted().size());
        assertEquals(1, response.getFailed().size());
        assertTrue(response.getDeleted().contains("device2"));
        assertEquals("device1", response.getFailed().get(0).getDeviceId());
        assertTrue(response.getFailed().get(0).getError().contains("Database error"));
    }
}
