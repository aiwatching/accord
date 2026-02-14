package com.example.devicemanager.service;

import com.example.devicemanager.dto.CreateInterfaceRequest;
import com.example.devicemanager.dto.UpdateInterfaceRequest;
import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.example.devicemanager.model.NetworkInterface;
import com.example.devicemanager.repository.DeviceRepository;
import com.example.devicemanager.repository.NetworkInterfaceRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NetworkInterfaceServiceImplTest {

    @Mock
    private NetworkInterfaceRepository interfaceRepository;

    @Mock
    private DeviceRepository deviceRepository;

    @InjectMocks
    private NetworkInterfaceServiceImpl interfaceService;

    @Test
    void listInterfacesByDevice_returnsInterfacesForDevice() {
        // Arrange
        String deviceId = "device1";
        NetworkInterface iface1 = createTestInterface("iface1", deviceId, "eth0");
        NetworkInterface iface2 = createTestInterface("iface2", deviceId, "wlan0");
        when(interfaceRepository.findByDeviceId(deviceId)).thenReturn(Arrays.asList(iface1, iface2));

        // Act
        List<NetworkInterface> result = interfaceService.listInterfacesByDevice(deviceId);

        // Assert
        assertEquals(2, result.size());
        verify(interfaceRepository, times(1)).findByDeviceId(deviceId);
    }

    @Test
    void getInterface_interfaceExists_returnsInterface() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        NetworkInterface iface = createTestInterface(interfaceId, deviceId, "eth0");
        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.of(iface));

        // Act
        Optional<NetworkInterface> result = interfaceService.getInterface(deviceId, interfaceId);

        // Assert
        assertTrue(result.isPresent());
        assertEquals(interfaceId, result.get().getId());
        verify(interfaceRepository, times(1)).findByIdAndDeviceId(interfaceId, deviceId);
    }

    @Test
    void getInterface_interfaceDoesNotExist_returnsEmpty() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.empty());

        // Act
        Optional<NetworkInterface> result = interfaceService.getInterface(deviceId, interfaceId);

        // Assert
        assertFalse(result.isPresent());
    }

    @Test
    void createInterface_validRequest_createsInterface() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");
        request.setIpAddress("192.168.1.100");
        request.setEnabled(true);

        when(deviceRepository.existsById(deviceId)).thenReturn(true);
        when(interfaceRepository.save(any(NetworkInterface.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Act
        NetworkInterface result = interfaceService.createInterface(deviceId, request);

        // Assert
        assertNotNull(result);
        assertEquals(deviceId, result.getDeviceId());
        assertEquals("eth0", result.getName());
        assertEquals(InterfaceType.ETHERNET, result.getType());
        assertEquals("AA:BB:CC:DD:EE:FF", result.getMacAddress());
        assertEquals("192.168.1.100", result.getIpAddress());
        assertEquals(InterfaceStatus.UNKNOWN, result.getStatus());
        assertTrue(result.getEnabled());
        assertNotNull(result.getId());

        verify(deviceRepository, times(1)).existsById(deviceId);
        verify(interfaceRepository, times(1)).save(any(NetworkInterface.class));
    }

    @Test
    void createInterface_deviceDoesNotExist_throwsException() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");

        when(deviceRepository.existsById(deviceId)).thenReturn(false);

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> interfaceService.createInterface(deviceId, request));
        verify(interfaceRepository, never()).save(any());
    }

    @Test
    void createInterface_missingName_throwsException() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");

        when(deviceRepository.existsById(deviceId)).thenReturn(true);

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> interfaceService.createInterface(deviceId, request));
    }

    @Test
    void createInterface_invalidMacAddress_throwsException() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("invalid-mac");

        when(deviceRepository.existsById(deviceId)).thenReturn(true);

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> interfaceService.createInterface(deviceId, request));
    }

    @Test
    void createInterface_invalidIpAddress_throwsException() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");
        request.setIpAddress("999.999.999.999");

        when(deviceRepository.existsById(deviceId)).thenReturn(true);

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> interfaceService.createInterface(deviceId, request));
    }

    @Test
    void createInterface_enabledDefaultsToTrue() {
        // Arrange
        String deviceId = "device1";
        CreateInterfaceRequest request = new CreateInterfaceRequest();
        request.setName("eth0");
        request.setType(InterfaceType.ETHERNET);
        request.setMacAddress("AA:BB:CC:DD:EE:FF");
        // Note: enabled is not set

        when(deviceRepository.existsById(deviceId)).thenReturn(true);
        when(interfaceRepository.save(any(NetworkInterface.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Act
        NetworkInterface result = interfaceService.createInterface(deviceId, request);

        // Assert
        assertTrue(result.getEnabled());
    }

    @Test
    void updateInterface_validRequest_updatesInterface() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        NetworkInterface existing = createTestInterface(interfaceId, deviceId, "eth0");
        existing.setIpAddress("192.168.1.100");

        UpdateInterfaceRequest request = new UpdateInterfaceRequest();
        request.setName("eth1");
        request.setIpAddress("192.168.1.101");
        request.setEnabled(false);

        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.of(existing));
        when(interfaceRepository.save(any(NetworkInterface.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Act
        Optional<NetworkInterface> result = interfaceService.updateInterface(deviceId, interfaceId, request);

        // Assert
        assertTrue(result.isPresent());
        assertEquals("eth1", result.get().getName());
        assertEquals("192.168.1.101", result.get().getIpAddress());
        assertFalse(result.get().getEnabled());

        verify(interfaceRepository, times(1)).save(any(NetworkInterface.class));
    }

    @Test
    void updateInterface_interfaceDoesNotExist_returnsEmpty() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        UpdateInterfaceRequest request = new UpdateInterfaceRequest();
        request.setName("eth1");

        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.empty());

        // Act
        Optional<NetworkInterface> result = interfaceService.updateInterface(deviceId, interfaceId, request);

        // Assert
        assertFalse(result.isPresent());
        verify(interfaceRepository, never()).save(any());
    }

    @Test
    void updateInterface_invalidIpAddress_throwsException() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        NetworkInterface existing = createTestInterface(interfaceId, deviceId, "eth0");

        UpdateInterfaceRequest request = new UpdateInterfaceRequest();
        request.setIpAddress("invalid-ip");

        when(interfaceRepository.findByIdAndDeviceId(interfaceId, deviceId)).thenReturn(Optional.of(existing));

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () ->
            interfaceService.updateInterface(deviceId, interfaceId, request));
    }

    @Test
    void deleteInterface_interfaceExists_deletesAndReturnsTrue() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        when(interfaceRepository.existsByIdAndDeviceId(interfaceId, deviceId)).thenReturn(true);

        // Act
        boolean result = interfaceService.deleteInterface(deviceId, interfaceId);

        // Assert
        assertTrue(result);
        verify(interfaceRepository, times(1)).deleteById(interfaceId);
    }

    @Test
    void deleteInterface_interfaceDoesNotExist_returnsFalse() {
        // Arrange
        String deviceId = "device1";
        String interfaceId = "iface1";
        when(interfaceRepository.existsByIdAndDeviceId(interfaceId, deviceId)).thenReturn(false);

        // Act
        boolean result = interfaceService.deleteInterface(deviceId, interfaceId);

        // Assert
        assertFalse(result);
        verify(interfaceRepository, never()).deleteById(anyString());
    }

    private NetworkInterface createTestInterface(String id, String deviceId, String name) {
        NetworkInterface iface = new NetworkInterface();
        iface.setId(id);
        iface.setDeviceId(deviceId);
        iface.setName(name);
        iface.setType(InterfaceType.ETHERNET);
        iface.setMacAddress("AA:BB:CC:DD:EE:FF");
        iface.setStatus(InterfaceStatus.UP);
        iface.setEnabled(true);
        return iface;
    }
}
